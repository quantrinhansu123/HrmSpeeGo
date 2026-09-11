import { useCallback, useEffect, useMemo, useState } from 'react'
import { fbGet, fbGetAttendanceLogsByMonth, fbGetEmployeesDirectory, fbListCollectionIds, fbSet } from '../services/firebase'
import {
  buildAttendanceSummary,
  hydrateAttendanceSummaryRows,
  serializeAttendanceSummaryRows
} from '../utils/attendanceSummary'
import AttendanceImportModal from '../components/AttendanceImportModal'
import { dayOfWeekFromDate, formatTimeHM } from '../components/AttendanceModal'
import {
  formatAttendanceTime,
  normalizeAttendanceShiftSettings,
  resolveAttendanceShift
} from '../utils/attendanceShift'
import './AttendancePreview.css'

const EXCEL_DETAIL_PAGE_SIZE = 100
const EXCEL_DETAIL_PAGE_SIZE_OPTIONS = [50, 100, 200]
const normalizeSearch = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

let XLSX = null
const ensureXlsx = async () => {
  if (!XLSX) {
    const mod = await import('xlsx-js-style')
    XLSX = mod.default || mod
  }
  return XLSX
}

const enrichExcelLog = (log, employeesById) => {
  const employee = employeesById.get(String(log.employeeId || '')) || null
  const excelCode = String(
    log.sourceEmployeeCode ||
    log.maNV ||
    log.ma_nv ||
    log.excelEmployeeCode ||
    ''
  ).trim()
  // Prefer mã trong file Excel; chỉ dùng employeeCode nếu không phải UUID hệ thống.
  const storedCode = String(log.employeeCode || '').trim()
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedCode)
  const employeeCode = excelCode || (!looksLikeUuid ? storedCode : '') || ''
  const employeeName =
    log.sourceEmployeeName ||
    log.employeeName ||
    employee?.ho_va_ten ||
    employee?.name ||
    ''
  const department =
    log.department ||
    log.phongBan ||
    employee?.bo_phan ||
    employee?.department ||
    ''
  const shiftFromProfile = employee?.ca_lam_viec || employee?.shift || ''
  return {
    ...log,
    displayEmployeeCode: employeeCode,
    employeeCode: employeeCode || storedCode,
    employeeName,
    department,
    phongBan: department,
    profileShift: shiftFromProfile,
    shiftName: shiftFromProfile || log.shiftName || log.tenCa || '',
    tenCa: shiftFromProfile || log.tenCa || log.shiftName || ''
  }
}

const currentMonthValue = () => new Date().toISOString().slice(0, 7)
const formatGeneratedAt = value => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN')
}
const dateText = value => {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}` : value || ''
}
const weekdayText = (monthValue, day) => {
  const [year, monthNumber] = String(monthValue || '').split('-').map(Number)
  if (!year || !monthNumber) return ''
  return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(year, monthNumber - 1, day).getDay()]
}
const dayCode = day => {
  if (!day) return ''
  const statuses = (day.logs || []).map(log => String(log.kyHieuPlus || log.kyHieu || log.status || '').trim().toUpperCase()).filter(Boolean)
  const code = statuses.find(value => ['X', 'X1', 'X2', 'X3', 'P1'].includes(value))
  if (code) return code
  if (day.paidLeaveWorkdays > 0 || statuses.includes('V')) return 'P1'
  if (day.unapprovedAbsence) return 'X'
  return Number(day.workdays) || ''
}
const dayNotes = day => {
  if (!day) return ''
  const notes = []
  if (day.late) notes.push(`Muộn ${day.lateMinutes || 0}p`)
  if (day.early) notes.push(`Sớm ${day.earlyMinutes || 0}p`)
  if (day.missingPunch) notes.push('Quên chấm')
  if (day.unapprovedAbsence) notes.push('Nghỉ không phép')
  if (day.paidLeaveWorkdays > 0) notes.push(`Phép ${day.paidLeaveWorkdays}`)
  if (day.overtimeHours > 0) notes.push(`TC ${day.overtimeHours}h`)
  return notes.join(' · ')
}

const TEAM_DEPARTMENTS = new Map([
  ['tuấn', 'MKT'],
  ['toàn', 'Kế toán'],
  ['trang', 'Sale'],
  ['quốc anh', 'Vận hành'],
  ['hưng', 'Vận hành']
])
const inferDepartmentFromPosition = position => {
  const value = String(position || '').trim().toLocaleLowerCase('vi')
  if (!value) return ''
  if (/nhân sự|\bhr\b|admin/.test(value)) return 'Nhân sự'
  if (/kế toán|account/.test(value)) return 'Kế toán'
  if (/social media|marketing|\bmkt\b|seo|content|designer|media/.test(value)) return 'MKT'
  if (/sale|kinh doanh/.test(value)) return 'Sale'
  if (/vận hành|kho|thu mua|xuất nhập khẩu|logistics/.test(value)) return 'Vận hành'
  return ''
}
const resolveDepartment = row => {
  const storedDepartment = String(row.department || '').trim()
  const teamDepartment = TEAM_DEPARTMENTS.get(storedDepartment.toLocaleLowerCase('vi'))
  return teamDepartment || inferDepartmentFromPosition(row.position) || storedDepartment || 'Chưa phân bộ phận'
}
const getConsecutiveDepartmentRowSpans = rows => rows.map((row, index) => {
  const department = row.displayDepartment
  if (!department) return 1
  const previousDepartment = rows[index - 1]?.displayDepartment
  if (department === previousDepartment) return 0
  let rowSpan = 1
  while (rows[index + rowSpan]?.displayDepartment === department) rowSpan += 1
  return rowSpan
})
const groupRowsByDepartment = rows => {
  const groups = new Map()
  rows.forEach(row => {
    const department = resolveDepartment(row)
    const key = department.toLocaleLowerCase('vi')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...row, displayDepartment: department })
  })
  return Array.from(groups.values()).flat()
}

function AttendancePreview() {
  const [month, setMonth] = useState(currentMonthValue)
  const [summaryMonths, setSummaryMonths] = useState([])
  const [rows, setRows] = useState([])
  const [generatedAt, setGeneratedAt] = useState('')
  const [sourceLogCount, setSourceLogCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [summarizing, setSummarizing] = useState(false)
  const [error, setError] = useState('')
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importEmployees, setImportEmployees] = useState([])
  const [importLogs, setImportLogs] = useState([])
  const [attendanceSettings, setAttendanceSettings] = useState(() => normalizeAttendanceShiftSettings())
  const [confirmations, setConfirmations] = useState({})
  const [confirmSaving, setConfirmSaving] = useState(false)
  const [detailRow, setDetailRow] = useState(null)
  const [isExcelDetailOpen, setIsExcelDetailOpen] = useState(false)
  const [excelLogs, setExcelLogs] = useState([])
  const [excelLogsLoading, setExcelLogsLoading] = useState(false)
  const [excelSearch, setExcelSearch] = useState('')
  const [excelPage, setExcelPage] = useState(1)
  const [excelPageSize, setExcelPageSize] = useState(EXCEL_DETAIL_PAGE_SIZE)

  const applySnapshot = useCallback((snapshot, nextMonth) => {
    if (!snapshot?.rows) {
      setRows([])
      setGeneratedAt('')
      setSourceLogCount(0)
      setHasSnapshot(false)
      return []
    }
    const nextRows = groupRowsByDepartment(hydrateAttendanceSummaryRows(snapshot.rows))
    setRows(nextRows)
    setGeneratedAt(snapshot.generatedAt || '')
    setSourceLogCount(Number(snapshot.sourceLogCount || 0))
    setHasSnapshot(true)
    if (nextMonth) setMonth(nextMonth)
    return nextRows
  }, [])

  const loadConfirmations = useCallback(async (targetMonth) => {
    if (!targetMonth) {
      setConfirmations({})
      return
    }
    try {
      const data = await fbGet(`hr/attendanceMonthConfirmations/${targetMonth}`)
      setConfirmations(data && typeof data === 'object' ? data : {})
    } catch (requestError) {
      console.warn('Không tải được xác nhận bảng công:', requestError)
      setConfirmations({})
    }
  }, [])

  const loadSummaryIndex = useCallback(async () => {
    const ids = await fbListCollectionIds('attendanceMonthSummaries')
    const months = ids.filter(value => /^\d{4}-\d{2}$/.test(value)).sort().reverse()
    setSummaryMonths(months)
    return months
  }, [])

  const loadMonthSnapshot = useCallback(async (targetMonth) => {
    if (!targetMonth) return
    setLoading(true)
    setError('')
    try {
      const [snapshot, storedSettings] = await Promise.all([
        fbGet(`hr/attendanceMonthSummaries/${targetMonth}`),
        fbGet('hr/attendanceSettings/default'),
        loadConfirmations(targetMonth)
      ])
      setAttendanceSettings(normalizeAttendanceShiftSettings(storedSettings))
      applySnapshot(snapshot, targetMonth)
    } catch (requestError) {
      console.error('Không tải được bảng công đã tổng hợp:', requestError)
      setError('Không thể tải bảng công đã tổng hợp.')
      applySnapshot(null, targetMonth)
      setConfirmations({})
    } finally {
      setLoading(false)
    }
  }, [applySnapshot, loadConfirmations])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const months = await loadSummaryIndex()
        if (cancelled) return
        const current = currentMonthValue()
        const initialMonth = months.includes(current) ? current : (months[0] || current)
        const [initialSnapshot, storedSettings] = await Promise.all([
          fbGet(`hr/attendanceMonthSummaries/${initialMonth}`),
          fbGet('hr/attendanceSettings/default'),
          loadConfirmations(initialMonth)
        ])
        if (cancelled) return
        setAttendanceSettings(normalizeAttendanceShiftSettings(storedSettings))
        setMonth(initialMonth)
        applySnapshot(initialSnapshot, initialMonth)
      } catch (requestError) {
        console.error('Không tải được danh sách bảng công:', requestError)
        if (!cancelled) setError('Không thể tải dữ liệu bảng công.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [applySnapshot, loadConfirmations, loadSummaryIndex])

  const handleMonthChange = async (nextMonth) => {
    setMonth(nextMonth)
    await loadMonthSnapshot(nextMonth)
  }

  const handleOpenExcelDetail = async () => {
    const targetMonth = month || currentMonthValue()
    setIsExcelDetailOpen(true)
    setExcelLogsLoading(true)
    setExcelSearch('')
    setExcelPage(1)
    setExcelPageSize(EXCEL_DETAIL_PAGE_SIZE)
    try {
      const [logsData, empData] = await Promise.all([
        fbGetAttendanceLogsByMonth(targetMonth),
        fbGetEmployeesDirectory()
      ])
      const employeesById = new Map(
        (empData
          ? Object.entries(empData).map(([id, value]) => ({ ...value, id }))
          : []
        ).map(employee => [String(employee.id), employee])
      )
      const list = logsData
        ? Object.entries(logsData).map(([id, value]) =>
            enrichExcelLog({ ...value, id }, employeesById)
          )
        : []
      list.sort((a, b) => {
        const nameA = String(a.employeeName || a.machineName || a.tenTheoMayChamCong || '')
        const nameB = String(b.employeeName || b.machineName || b.tenTheoMayChamCong || '')
        if (nameA !== nameB) return nameA.localeCompare(nameB, 'vi')
        return String(a.date || a.timestamp || '').localeCompare(String(b.date || b.timestamp || ''))
      })
      setExcelLogs(list)
    } catch (requestError) {
      console.error('Không tải được bảng chi tiết Excel:', requestError)
      setExcelLogs([])
      alert('Không tải được bảng chi tiết từ Excel: ' + (requestError.message || requestError))
    } finally {
      setExcelLogsLoading(false)
    }
  }

  const handleDownloadExcelDetail = async () => {
    if (!filteredExcelLogs.length) {
      alert('Không có dữ liệu để tải Excel.')
      return
    }
    try {
      await ensureXlsx()
      const rows = filteredExcelLogs.map((log, index) => {
        const dateStr = log.date ? String(log.date).slice(0, 10) : ''
        const hours = Number(log.hours ?? log.soGio ?? log.gio ?? 0) || 0
        const gioPlus = Number(log.gioPlus ?? 0) || 0
        const tongGio = Number(log.tongGio ?? hours + gioPlus) || 0
        const late = Number(log.lateMinutes ?? log.vaoTre ?? 0) || 0
        const early = Number(log.earlyMinutes ?? log.raSom ?? 0) || 0
        return {
          STT: index + 1,
          'Mã NV': log.displayEmployeeCode || log.sourceEmployeeCode || log.employeeCode || '',
          'Họ tên': log.employeeName || '',
          'Tên máy CC': log.machineName || log.tenTheoMayChamCong || '',
          'Phòng ban': log.department || log.phongBan || '',
          Ngày: dateStr
            ? new Date(`${dateStr}T00:00:00`).toLocaleDateString('vi-VN')
            : '',
          Thứ: log.dayOfWeek || log.thu || dayOfWeekFromDate(dateStr) || '',
          Vào: formatTimeHM(log.vao || log.checkIn) || '',
          Ra: formatTimeHM(log.ra || log.checkOut) || '',
          Công: log.cong ?? '',
          Giờ: hours || '',
          'Công+': log.congPlus ?? '',
          'Vào trễ': late || '',
          'Ra sớm': early || '',
          TC1: log.tc1 ?? '',
          TC2: log.tc2 ?? '',
          TC3: log.tc3 ?? '',
          Ca: log.profileShift || log.shiftName || log.tenCa || '',
          KH: log.kyHieu || log.status || '',
          'KH+': log.kyHieuPlus || '',
          'Tổng giờ': tongGio || ''
        }
      })
      const worksheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'BangChiTiet')
      XLSX.writeFile(workbook, `Bang_cham_cong_chi_tiet_${month || currentMonthValue()}.xlsx`)
    } catch (requestError) {
      console.error('Không tải được Excel bảng chi tiết:', requestError)
      alert('Không tải được Excel: ' + (requestError.message || requestError))
    }
  }

  const filteredExcelLogs = useMemo(() => {
    const term = normalizeSearch(excelSearch)
    if (!term) return excelLogs
    return excelLogs.filter(log => {
      const haystack = [
        log.displayEmployeeCode,
        log.sourceEmployeeCode,
        log.employeeCode,
        log.employeeName,
        log.machineName,
        log.tenTheoMayChamCong,
        log.department,
        log.phongBan,
        log.date
      ].map(normalizeSearch).join(' ')
      return haystack.includes(term)
    })
  }, [excelLogs, excelSearch])

  const excelTotalPages = Math.max(1, Math.ceil(filteredExcelLogs.length / excelPageSize) || 1)
  const excelSafePage = Math.min(excelPage, excelTotalPages)
  const excelPageStart = filteredExcelLogs.length === 0 ? 0 : (excelSafePage - 1) * excelPageSize + 1
  const excelPageEnd = Math.min(excelSafePage * excelPageSize, filteredExcelLogs.length)

  const visibleExcelLogs = useMemo(
    () => filteredExcelLogs.slice((excelSafePage - 1) * excelPageSize, excelSafePage * excelPageSize),
    [excelPageSize, excelSafePage, filteredExcelLogs]
  )

  useEffect(() => {
    setExcelPage(1)
  }, [excelSearch, excelPageSize])

  useEffect(() => {
    if (excelPage > excelTotalPages) setExcelPage(excelTotalPages)
  }, [excelPage, excelTotalPages])

  const handleOpenImport = async () => {
    try {
      const [empData, logsData, storedSettings] = await Promise.all([
        fbGetEmployeesDirectory(),
        fbGetAttendanceLogsByMonth(month || currentMonthValue()),
        fbGet('hr/attendanceSettings/default')
      ])
      setAttendanceSettings(normalizeAttendanceShiftSettings(storedSettings))
      if (empData) {
        setImportEmployees(
          Array.isArray(empData)
            ? empData
            : Object.entries(empData).map(([id, value]) => ({ ...value, id }))
        )
      }
      if (logsData) {
        setImportLogs(
          Array.isArray(logsData)
            ? logsData
            : Object.entries(logsData).map(([id, value]) => ({ ...value, id }))
        )
      }
    } catch (err) {
      console.warn('Không thể nạp trước dữ liệu nhân sự để import:', err)
    }
    setIsImportOpen(true)
  }

  const saveMonthSummary = useCallback(async (targetMonth, { silent = false } = {}) => {
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      throw new Error('Tháng không hợp lệ. Dùng định dạng YYYY-MM.')
    }

    const [employeeData, logData, nextAdjustments, nextManuals, storedSettings] = await Promise.all([
      fbGetEmployeesDirectory(),
      fbGetAttendanceLogsByMonth(targetMonth),
      fbGet(`hr/attendanceAdjustments/${targetMonth}`),
      fbGet(`hr/manualWorkdays/${targetMonth}`),
      fbGet('hr/attendanceSettings/default')
    ])
    const nextAttendanceSettings = normalizeAttendanceShiftSettings(storedSettings)
    setAttendanceSettings(nextAttendanceSettings)
    const employeeList = employeeData
      ? Object.entries(employeeData).map(([id, value]) => ({ ...value, id }))
      : []
    const monthLogs = logData
      ? Object.entries(logData).map(([id, value]) => ({ ...value, id }))
      : []
    const summaryRows = buildAttendanceSummary({
      attendanceLogs: monthLogs,
      employees: employeeList,
      month: targetMonth,
      attendanceAdjustments: nextAdjustments || {},
      manualWorkdays: nextManuals || {},
      attendanceSettings: nextAttendanceSettings
    })
    const snapshot = {
      month: targetMonth,
      generatedAt: new Date().toISOString(),
      sourceLogCount: monthLogs.length,
      employeeCount: summaryRows.length,
      rows: serializeAttendanceSummaryRows(summaryRows)
    }
    await fbSet(`hr/attendanceMonthSummaries/${targetMonth}`, snapshot)
    applySnapshot(snapshot, targetMonth)
    setSummaryMonths(prev => {
      const next = new Set(prev)
      next.add(targetMonth)
      return Array.from(next).sort().reverse()
    })
    if (!silent) {
      alert(`Đã lưu bảng công tháng ${targetMonth} (${summaryRows.length} nhân viên).`)
    }
    return snapshot
  }, [applySnapshot])

  const handleImportComplete = async () => {
    setIsImportOpen(false)
    const targetMonth = month || currentMonthValue()
    setSummarizing(true)
    setError('')
    try {
      await saveMonthSummary(targetMonth, { silent: true })
      await loadSummaryIndex()
      if (isExcelDetailOpen) {
        await handleOpenExcelDetail()
      }
      alert(`Đã đồng bộ Excel và lưu bảng công tháng ${targetMonth}.`)
    } catch (requestError) {
      console.error('Lưu bảng công sau import thất bại:', requestError)
      alert('Import xong nhưng chưa lưu được bảng công: ' + (requestError.message || requestError))
      await loadMonthSnapshot(targetMonth)
    } finally {
      setSummarizing(false)
    }
  }

  const handleSummarize = async () => {
    const targetMonth = month || currentMonthValue()
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      alert('Tháng không hợp lệ. Dùng định dạng YYYY-MM.')
      return
    }
    if (!confirm(`Tổng hợp lại bảng công tháng ${targetMonth} từ dữ liệu chấm công hiện có?`)) {
      return
    }

    setSummarizing(true)
    setError('')
    try {
      await saveMonthSummary(targetMonth)
    } catch (requestError) {
      console.error('Tổng hợp bảng công thất bại:', requestError)
      alert('Lỗi tổng hợp bảng công: ' + (requestError.message || requestError))
    } finally {
      setSummarizing(false)
    }
  }

  const handleToggleConfirm = async (employeeId, checked) => {
    const targetMonth = month || currentMonthValue()
    const key = String(employeeId)
    const previous = confirmations
    const next = { ...confirmations }
    if (checked) next[key] = true
    else delete next[key]
    setConfirmations(next)
    setConfirmSaving(true)
    try {
      await fbSet(`hr/attendanceMonthConfirmations/${targetMonth}`, next)
    } catch (requestError) {
      console.error('Không lưu được xác nhận:', requestError)
      setConfirmations(previous)
      alert('Không lưu được xác nhận: ' + (requestError.message || requestError))
    } finally {
      setConfirmSaving(false)
    }
  }

  const allConfirmed = rows.length > 0 && rows.every(row => confirmations[String(row.employeeId)])

  const handleToggleConfirmAll = async (checked) => {
    const targetMonth = month || currentMonthValue()
    const previous = confirmations
    const next = checked
      ? Object.fromEntries(rows.map(row => [String(row.employeeId), true]))
      : {}
    setConfirmations(next)
    setConfirmSaving(true)
    try {
      await fbSet(`hr/attendanceMonthConfirmations/${targetMonth}`, next)
    } catch (requestError) {
      console.error('Không lưu được xác nhận:', requestError)
      setConfirmations(previous)
      alert('Không lưu được xác nhận: ' + (requestError.message || requestError))
    } finally {
      setConfirmSaving(false)
    }
  }

  const departmentRowSpans = useMemo(() => getConsecutiveDepartmentRowSpans(rows), [rows])
  const calendar = useMemo(() => {
    const [year, monthNumber] = String(month || '').split('-').map(Number)
    const daysInMonth = year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 31
    return Array.from({ length: 31 }, (_, index) => {
      const day = index + 1
      const weekday = day <= daysInMonth ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(year, monthNumber - 1, day).getDay()] : ''
      return { day, weekday }
    })
  }, [month])
  const weeklyPeople = useMemo(() => {
    const weekRanges = [1, 8, 15, 22, 29].map((start, index) => ({
      label: `Tuần ${index + 1}`,
      start,
      end: Math.min(start + 6, calendar.length)
    }))
    const checks = [
      ['Đi muộn', day => day?.late],
      ['Không chấm công', day => day?.missingPunch],
      ['Nghỉ không phép', day => day?.unapprovedAbsence]
    ]

    return rows
      .map(row => {
        const weeks = weekRanges.map(week => {
          const flags = checks
            .filter(([, predicate]) =>
              Array.from(
                { length: Math.max(0, week.end - week.start + 1) },
                (_, offset) => row.days.get(`${month}-${String(week.start + offset).padStart(2, '0')}`)
              ).some(predicate)
            )
            .map(([label]) => label)
          return { label: week.label, flags }
        })
        const hasIssue = weeks.some(week => week.flags.length > 0)
        if (!hasIssue) return null
        return {
          employeeId: row.employeeId,
          employeeCode: row.employeeCode || '',
          employeeName: row.employeeName || '',
          weeks
        }
      })
      .filter(Boolean)
  }, [calendar.length, month, rows])
  const weekLabels = useMemo(
    () => [1, 2, 3, 4, 5].map(index => `Tuần ${index}`),
    []
  )
  const detailDays = useMemo(() => {
    if (!detailRow || !month) return []
    const [year, monthNumber] = String(month).split('-').map(Number)
    const daysInMonth = year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 0
    const fallbackShift = resolveAttendanceShift(
      {
        shift: detailRow.shift,
        ca_lam_viec: detailRow.shift,
        standardCheckIn: detailRow.standardCheckIn,
        standardCheckOut: detailRow.standardCheckOut
      },
      { shiftName: detailRow.shift, tenCa: detailRow.shift },
      attendanceSettings
    )
    const fallbackStandardIn = formatAttendanceTime(fallbackShift?.start || fallbackShift?.standardCheckIn)
    const fallbackStandardOut = formatAttendanceTime(fallbackShift?.end || fallbackShift?.standardCheckOut)

    return Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1
      const date = `${month}-${String(day).padStart(2, '0')}`
      const dayData = detailRow.days?.get?.(date) || null
      const log = dayData?.logs?.[0] || {}
      const checkIn = formatAttendanceTime(
        dayData?.checkIn || log.checkIn || log.vao || ''
      )
      const checkOut = formatAttendanceTime(
        dayData?.checkOut || log.checkOut || log.ra || ''
      )
      const standardCheckIn = formatAttendanceTime(
        dayData?.standardCheckIn || fallbackStandardIn
      )
      const standardCheckOut = formatAttendanceTime(
        dayData?.standardCheckOut || fallbackStandardOut
      )
      return {
        day,
        date,
        weekday: weekdayText(month, day),
        code: dayCode(dayData),
        workdays: dayData?.workdays || '',
        hours: dayData?.hours || '',
        overtimeHours: dayData?.overtimeHours || '',
        checkIn,
        checkOut,
        standardCheckIn,
        standardCheckOut,
        notes: dayNotes(dayData),
        hasData: Boolean(dayData)
      }
    })
  }, [attendanceSettings, detailRow, month])
  const detailStandardLabel = useMemo(() => {
    if (!detailDays.length) return ''
    const sample = detailDays.find(item => item.standardCheckIn && item.standardCheckOut) || detailDays[0]
    if (!sample?.standardCheckIn || !sample?.standardCheckOut) return ''
    return `${sample.standardCheckIn} - ${sample.standardCheckOut}`
  }, [detailDays])

  if (loading) return <div className="attendance-preview-state">Đang tải bảng công đã tổng hợp...</div>
  if (error && !hasSnapshot) return <div className="attendance-preview-state is-error">{error}</div>

  return <div className="attendance-preview-page">
    <header>
      <div>
        <h1>Bảng công {month}</h1>
        <p>
          {hasSnapshot
            ? `Đã lưu lúc ${formatGeneratedAt(generatedAt)}${sourceLogCount ? ` · ${sourceLogCount} bản ghi chấm công` : ''}`
            : 'Chưa có bảng công tháng này · Tải Excel để đồng bộ và lưu'}
        </p>
      </div>
      <div className="attendance-preview-actions">
        <label>
          Tháng
          <input
            type="month"
            value={month}
            onChange={event => handleMonthChange(event.target.value)}
            disabled={summarizing}
          />
        </label>
        {summaryMonths.length > 0 && (
          <label>
            Đã lưu
            <select
              value={summaryMonths.includes(month) ? month : ''}
              onChange={event => event.target.value && handleMonthChange(event.target.value)}
              disabled={summarizing}
            >
              {!summaryMonths.includes(month) && <option value="">Chọn tháng đã lưu</option>}
              {summaryMonths.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        )}
        <button
          type="button"
          className="attendance-preview-import-btn"
          onClick={handleOpenImport}
          disabled={summarizing}
        >
          Tải Excel & Lưu bảng công
        </button>
        <button
          type="button"
          className="attendance-preview-detail-btn"
          onClick={handleOpenExcelDetail}
          disabled={summarizing || excelLogsLoading}
          title="Xem bảng chấm công chi tiết đã tải từ Excel"
        >
          {excelLogsLoading ? 'Đang tải...' : 'Xem bảng chi tiết'}
        </button>
        {hasSnapshot && (
          <button type="button" className="attendance-preview-summarize" onClick={handleSummarize} disabled={summarizing}>
            {summarizing ? 'Đang lưu...' : 'Tổng hợp lại'}
          </button>
        )}
      </div>
    </header>

    {!hasSnapshot ? (
      <div className="attendance-preview-empty">
        <p>Tháng {month} chưa có bảng công đã lưu.</p>
        <p>Bấm <strong>Tải Excel & Lưu bảng công</strong> để đẩy file Excel lên — hệ thống sẽ đồng bộ và lưu bảng công ngay.</p>
      </div>
    ) : (
      <>
        <div className="attendance-preview-scroll"><table className="attendance-preview-table is-compact">
          <thead>
            <tr className="groups">
              <th>STT</th>
              <th>
                <label className="attendance-confirm-cell">
                  <input
                    type="checkbox"
                    checked={allConfirmed}
                    disabled={confirmSaving || !rows.length}
                    onChange={event => handleToggleConfirmAll(event.target.checked)}
                    title="Xác nhận tất cả"
                  />
                  <span>Xác nhận</span>
                </label>
              </th>
              <th>Họ tên</th>
              <th>Bộ phận</th>
              <th>Ca làm</th>
              <th>Notes</th>
              <th>Tăng ca</th>
              <th>Phép sử dụng</th>
              <th>Công làm lễ</th>
              <th>Công lễ</th>
              <th>Tổng công</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.employeeId} className={confirmations[String(row.employeeId)] ? 'is-confirmed' : ''}>
                <td>{index + 1}</td>
                <td>
                  <input
                    type="checkbox"
                    className="attendance-confirm-check"
                    checked={Boolean(confirmations[String(row.employeeId)])}
                    disabled={confirmSaving}
                    onChange={event => handleToggleConfirm(row.employeeId, event.target.checked)}
                    aria-label={`Xác nhận ${row.employeeName || ''}`}
                  />
                </td>
                <td
                  className="name is-clickable"
                  onClick={() => setDetailRow(row)}
                  title="Xem chi tiết từng ngày"
                >
                  {row.employeeName}
                </td>
                {departmentRowSpans[index] > 0 && (
                  <td rowSpan={departmentRowSpans[index]}>{row.displayDepartment}</td>
                )}
                <td>{row.shift}</td>
                <td>{row.lateCount ? `${row.lateCount} lần (${row.lateMinutes}p)` : ''}</td>
                <td>{row.overtimeHours || ''}</td>
                <td>{row.paidLeaveWorkdays || ''}</td>
                <td></td>
                <td></td>
                <td>{row.workdays || ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <section className="attendance-preview-weeks">
          <div className="attendance-preview-weeks__head">
            <h2>Tổng hợp theo tuần</h2>
            <span>{weeklyPeople.length} nhân sự có phát sinh</span>
          </div>
          <div className="attendance-preview-weeks__scroll">
            <table className="attendance-preview-weeks-table">
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Mã NV</th>
                  <th>Nhân sự</th>
                  {weekLabels.map(label => <th key={label}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {weeklyPeople.length === 0 ? (
                  <tr>
                    <td colSpan={3 + weekLabels.length} className="weeks-empty">Không có phát sinh theo tuần</td>
                  </tr>
                ) : (
                  weeklyPeople.map((person, index) => (
                    <tr key={person.employeeId || person.employeeName}>
                      <td>{index + 1}</td>
                      <td className="employee-code">{person.employeeCode || '-'}</td>
                      <td className="name">{person.employeeName}</td>
                      {person.weeks.map(week => (
                        <td key={week.label} className={week.flags.length ? 'has-issue' : ''}>
                          {week.flags.length ? week.flags.join(' · ') : '—'}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="attendance-preview-legend"><strong>Chú thích:</strong><span>X: Nghỉ theo lịch/không phép theo trạng thái</span><span>P1: Nghỉ phép năm</span><span>1 / 0.5: Công trong ngày</span></section>
      </>
    )}
    {isImportOpen && (
      <AttendanceImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSave={handleImportComplete}
        employees={importEmployees}
        attendanceLogs={importLogs}
        attendanceSettings={attendanceSettings}
      />
    )}
    {detailRow && (
      <div className="attendance-day-detail-overlay" onClick={() => setDetailRow(null)}>
        <div className="attendance-day-detail-modal" onClick={event => event.stopPropagation()}>
          <header>
            <div>
              <h2>{detailRow.employeeName}</h2>
              <p>
                {detailRow.employeeCode ? `${detailRow.employeeCode} · ` : ''}
                {detailRow.displayDepartment || detailRow.department || ''}
                {detailRow.shift ? ` · ${detailRow.shift}` : ''}
                {` · Tháng ${month}`}
              </p>
            </div>
            <button type="button" onClick={() => setDetailRow(null)}>Đóng</button>
          </header>
          <div className="attendance-day-detail-summary">
            <span>Tổng công: <strong>{detailRow.workdays || 0}</strong></span>
            <span>Tăng ca: <strong>{detailRow.overtimeHours || 0}</strong></span>
            <span>Phép: <strong>{detailRow.paidLeaveWorkdays || 0}</strong></span>
            <span>Muộn: <strong>{detailRow.lateCount || 0}</strong></span>
            <span>Quên chấm: <strong>{detailRow.missingPunchCount || 0}</strong></span>
            {detailStandardLabel && (
              <span className="is-standard">Giờ tiêu chuẩn: <strong>{detailStandardLabel}</strong></span>
            )}
          </div>
          <div className="attendance-day-detail-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Thứ</th>
                  <th>Ký hiệu</th>
                  <th>Giờ vào</th>
                  <th>Giờ ra</th>
                  <th>Tiêu chuẩn</th>
                  <th>Công</th>
                  <th>Giờ</th>
                  <th>Tăng ca</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {detailDays.map(item => (
                  <tr key={item.date} className={item.hasData ? '' : 'is-empty'}>
                    <td>{dateText(item.date)}</td>
                    <td>{item.weekday}</td>
                    <td>{item.code || '—'}</td>
                    <td className={item.checkIn && item.standardCheckIn && item.checkIn > item.standardCheckIn ? 'is-late' : ''}>
                      {item.checkIn || '—'}
                    </td>
                    <td className={item.checkOut && item.standardCheckOut && item.checkOut < item.standardCheckOut ? 'is-early' : ''}>
                      {item.checkOut || '—'}
                    </td>
                    <td className="standard">
                      {item.standardCheckIn && item.standardCheckOut
                        ? `${item.standardCheckIn} - ${item.standardCheckOut}`
                        : '—'}
                    </td>
                    <td>{item.workdays || '—'}</td>
                    <td>{item.hours || '—'}</td>
                    <td>{item.overtimeHours || '—'}</td>
                    <td className="note">{item.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}
    {isExcelDetailOpen && (
      <div className="attendance-day-detail-overlay" onClick={() => setIsExcelDetailOpen(false)}>
        <div
          className="attendance-excel-detail-modal"
          onClick={event => event.stopPropagation()}
        >
          <div className="attendance-excel-detail-head">
            <div>
              <h2>Bảng chi tiết từ Excel</h2>
              <p>
                Tháng {month}
                {excelLogsLoading
                  ? ' · Đang tải...'
                  : ` · ${filteredExcelLogs.length}/${excelLogs.length} dòng`}
              </p>
            </div>
            <div className="attendance-excel-detail-tools">
              <input
                type="search"
                placeholder="Tìm tên, mã NV, phòng ban..."
                value={excelSearch}
                onChange={event => setExcelSearch(event.target.value)}
              />
              <button
                type="button"
                className="attendance-excel-download-btn"
                onClick={handleDownloadExcelDetail}
                disabled={excelLogsLoading || !filteredExcelLogs.length}
              >
                Tải Excel
              </button>
              <button type="button" onClick={() => setIsExcelDetailOpen(false)}>Đóng</button>
            </div>
          </div>
          <div className="attendance-excel-detail-scroll">
            <table>
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Mã NV</th>
                  <th>Họ tên</th>
                  <th>Tên máy CC</th>
                  <th>Phòng ban</th>
                  <th>Ngày</th>
                  <th>Thứ</th>
                  <th>Vào</th>
                  <th>Ra</th>
                  <th>Công</th>
                  <th>Giờ</th>
                  <th>Công+</th>
                  <th>Vào trễ</th>
                  <th>Ra sớm</th>
                  <th>TC1</th>
                  <th>TC2</th>
                  <th>TC3</th>
                  <th>Ca</th>
                  <th>KH</th>
                  <th>KH+</th>
                  <th>Tổng giờ</th>
                </tr>
              </thead>
              <tbody>
                {excelLogsLoading ? (
                  <tr>
                    <td colSpan="21" className="empty">Đang tải bảng chi tiết...</td>
                  </tr>
                ) : visibleExcelLogs.length === 0 ? (
                  <tr>
                    <td colSpan="21" className="empty">
                      Chưa có dữ liệu Excel cho tháng này. Hãy dùng “Tải Excel & Lưu bảng công”.
                    </td>
                  </tr>
                ) : (
                  visibleExcelLogs.map((log, index) => {
                    const dateStr = log.date ? String(log.date).slice(0, 10) : ''
                    const hours = Number(log.hours ?? log.soGio ?? log.gio ?? 0) || 0
                    const gioPlus = Number(log.gioPlus ?? 0) || 0
                    const tongGio = Number(log.tongGio ?? hours + gioPlus) || 0
                    const late = Number(log.lateMinutes ?? log.vaoTre ?? 0) || 0
                    const early = Number(log.earlyMinutes ?? log.raSom ?? 0) || 0
                    return (
                      <tr key={log.id || `${log.employeeId}-${dateStr}-${index}`}>
                        <td>{excelPageStart + index}</td>
                        <td>{log.displayEmployeeCode || log.sourceEmployeeCode || log.employeeCode || '-'}</td>
                        <td>{log.employeeName || '-'}</td>
                        <td>{log.machineName || log.tenTheoMayChamCong || '-'}</td>
                        <td>{log.department || log.phongBan || '-'}</td>
                        <td>
                          {dateStr
                            ? new Date(`${dateStr}T00:00:00`).toLocaleDateString('vi-VN')
                            : '-'}
                        </td>
                        <td>{log.dayOfWeek || log.thu || dayOfWeekFromDate(dateStr) || '-'}</td>
                        <td>{formatTimeHM(log.vao || log.checkIn) || '-'}</td>
                        <td>{formatTimeHM(log.ra || log.checkOut) || '-'}</td>
                        <td>{log.cong ?? '-'}</td>
                        <td>{hours ? hours.toFixed(1) : '-'}</td>
                        <td>{log.congPlus ?? '-'}</td>
                        <td className={late > 0 ? 'is-late' : ''}>{late > 0 ? `${late}p` : '-'}</td>
                        <td className={early > 0 ? 'is-early' : ''}>{early > 0 ? `${early}p` : '-'}</td>
                        <td>{log.tc1 ?? '-'}</td>
                        <td>{log.tc2 ?? '-'}</td>
                        <td>{log.tc3 ?? '-'}</td>
                        <td>{log.profileShift || log.shiftName || log.tenCa || '-'}</td>
                        <td>{log.kyHieu || log.status || '-'}</td>
                        <td>{log.kyHieuPlus || '-'}</td>
                        <td><strong>{tongGio ? tongGio.toFixed(1) : '-'}</strong></td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredExcelLogs.length > 0 && (
            <div className="attendance-excel-detail-pager">
              <div className="attendance-excel-detail-pager__info">
                Hiển thị {excelPageStart}–{excelPageEnd} / {filteredExcelLogs.length} dòng
              </div>
              <div className="attendance-excel-detail-pager__controls">
                <label>
                  Mỗi trang
                  <select
                    value={excelPageSize}
                    onChange={event => setExcelPageSize(Number(event.target.value) || EXCEL_DETAIL_PAGE_SIZE)}
                  >
                    {EXCEL_DETAIL_PAGE_SIZE_OPTIONS.map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={excelSafePage <= 1}
                  onClick={() => setExcelPage(1)}
                >
                  «
                </button>
                <button
                  type="button"
                  disabled={excelSafePage <= 1}
                  onClick={() => setExcelPage(page => Math.max(1, page - 1))}
                >
                  Trước
                </button>
                <span className="attendance-excel-detail-pager__page">
                  Trang {excelSafePage}/{excelTotalPages}
                </span>
                <button
                  type="button"
                  disabled={excelSafePage >= excelTotalPages}
                  onClick={() => setExcelPage(page => Math.min(excelTotalPages, page + 1))}
                >
                  Sau
                </button>
                <button
                  type="button"
                  disabled={excelSafePage >= excelTotalPages}
                  onClick={() => setExcelPage(excelTotalPages)}
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
  </div>
}

export default AttendancePreview
