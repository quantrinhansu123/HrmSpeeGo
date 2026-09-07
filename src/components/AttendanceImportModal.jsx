import { useEffect, useMemo, useState } from 'react'
import XLSX from 'xlsx-js-style'
import { fbPush, fbUpdate } from '../services/firebase'
import {
  applyEmployeeToAttendanceLog,
  buildAttendanceRecordKey,
  buildSourceEmployeeKey,
  getCanonicalEmployeeCode,
  matchAttendanceEmployee,
  normalizeEmployeeIdentity
} from '../utils/attendanceMatching'
import {
  collectAttendancePunches,
  findAttendancePunchColumns,
  parseAttendanceDate,
  parseAttendanceTime
} from '../utils/attendanceImport'
import {
  applyCalculatedAttendanceTiming,
  calculateAttendanceTiming,
  formatAttendanceTime,
  resolveAttendanceShift
} from '../utils/attendanceShift'

const { read, utils, writeFile } = XLSX

function AttendanceImportModal({
  employees,
  attendanceLogs = [],
  attendanceSettings = {},
  isOpen,
  onClose,
  onSave
}) {
  const [file, setFile] = useState(null)
  const [referenceImage, setReferenceImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiAvailable, setAiAvailable] = useState(null)
  const [previewData, setPreviewData] = useState(null)
  const [importMonth, setImportMonth] = useState(new Date().toISOString().slice(0, 7)) // YYYY-MM
  const [matchBranch, setMatchBranch] = useState('HCM')

  const availableBranches = useMemo(
    () => Array.from(new Set(
      employees
        .map(employee => String(employee.chi_nhanh || employee.branch || '').trim())
        .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right, 'vi')),
    [employees]
  )

  const employeesById = useMemo(
    () => new Map(employees.map(employee => [String(employee.id), employee])),
    [employees]
  )

  const employeesForMatching = useMemo(() => {
    const normalizedBranch = normalizeEmployeeIdentity(matchBranch)
    const inBranch = normalizedBranch
      ? employees.filter(employee =>
          normalizeEmployeeIdentity(employee.chi_nhanh || employee.branch || '') ===
          normalizedBranch
        )
      : employees
    return (inBranch.length ? inBranch : employees)
      .slice()
      .sort((left, right) =>
        String(left.ho_va_ten || left.name || '').localeCompare(
          String(right.ho_va_ten || right.name || ''),
          'vi'
        )
      )
  }, [employees, matchBranch])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    fetch('/api/attendance-match')
      .then(response => response.json())
      .then(payload => {
        if (!cancelled) setAiAvailable(Boolean(payload.available))
      })
      .catch(() => {
        if (!cancelled) setAiAvailable(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  const handleFileChange = (e) => {
    setFile(e.target.files[0])
  }

  const parseTime = parseAttendanceTime

  const calculateStats = (timeStrs, employee = {}, log = {}) => {
    if (!timeStrs || timeStrs.length === 0) return null

    const parsed = timeStrs
      .map(t => (typeof t === 'object' && t?.str ? t : parseTime(t)))
      .filter(Boolean)
      .sort((a, b) => a.val - b.val)

    if (parsed.length === 0) return null

    const checkInStr = parsed[0].str
    const checkOutStr = parsed.length > 1 ? parsed[parsed.length - 1].str : null
    const inTime = parsed[0]
    const outTime = parsed.length > 1 ? parsed[parsed.length - 1] : null

    if (!outTime || parsed.length === 1) {
      return {
        checkIn: checkInStr,
        checkOut: null,
        hours: 0,
        status: 'Thiếu ra',
        lateMinutes: 0,
        earlyMinutes: 0,
        punches: parsed.map(p => p.str)
      }
    }

    const shift = resolveAttendanceShift(employee, log, attendanceSettings)
    const [startHour, startMinute] = shift.start.split(':').map(Number)
    const [endHour, endMinute] = shift.end.split(':').map(Number)
    const STANDARD_START = startHour + startMinute / 60
    const STANDARD_END = endHour + endMinute / 60
    const LUNCH_START = 12.0
    const LUNCH_END = 13.5
    const LUNCH_DURATION = 1.5

    let hours = outTime.val - inTime.val
    if (inTime.val <= LUNCH_END && outTime.val >= LUNCH_START) {
      hours -= LUNCH_DURATION
    }
    hours = Math.max(0, Math.round(hours * 10) / 10)

    const isLate = inTime.val > STANDARD_START
    const isEarly = outTime.val < STANDARD_END
    let lateMinutes = isLate ? Math.round((inTime.val - STANDARD_START) * 60) : 0
    let earlyMinutes = isEarly ? Math.round((STANDARD_END - outTime.val) * 60) : 0

    let status = 'Đủ'
    const notes = []
    if (isLate) notes.push(`Muộn ${lateMinutes}p`)
    if (isEarly) notes.push(`Sớm ${earlyMinutes}p`)
    if (notes.length > 0) status = notes.join(' & ')
    if (hours < 4) status = 'Vắng/Nghỉ'

    return {
      checkIn: checkInStr,
      checkOut: checkOutStr,
      hours,
      status,
      lateMinutes,
      earlyMinutes,
      punches: parsed.map(p => p.str)
    }
  }

  const findEmployee = (code, name) => {
    return matchAttendanceEmployee(code, name, employees, matchBranch).employee
  }

  const buildFallbackEmployee = (code, name, rowIndex = 0) => {
    const codeStr = String(code || '').trim()
    const nameStr = String(name || '').trim()
    const fallbackCode = codeStr || `ROW${rowIndex + 1}`
    const fallbackName = nameStr || `NV ${fallbackCode}`
    const sourceKey = buildSourceEmployeeKey(fallbackCode, fallbackName)
    return {
      id: `external:${sourceKey}`,
      employeeId: fallbackCode,
      username: fallbackCode,
      ho_va_ten: fallbackName,
      name: fallbackName,
      bo_phan: '',
      vi_tri: ''
    }
  }

  const attachSourceIdentity = (employee, code, name) => ({
    ...employee,
    _sourceEmployeeCode: String(code || '').trim(),
    _sourceEmployeeName: String(name || '').replace(/\s+/g, ' ').trim()
  })

  const parseDateValue = parseAttendanceDate

  const buildLog = (sysEmp, dateStr, stats, extra = {}) => {
    const baseDate = new Date(`${dateStr}T00:00:00`)
    const checkInStr = stats.checkIn || extra.vao || ''
    const checkOutStr = stats.checkOut || extra.ra || ''

    let checkInDate = null
    if (checkInStr) {
      const [inH, inM] = String(checkInStr).split(':')
      checkInDate = new Date(baseDate)
      checkInDate.setHours(Number(inH), Number(inM) || 0, 0, 0)
    }

    let checkOutDate = null
    if (checkOutStr) {
      const [outH, outM] = String(checkOutStr).split(':')
      checkOutDate = new Date(baseDate)
      checkOutDate.setHours(Number(outH), Number(outM) || 0, 0, 0)
    }

    const hours = Number(extra.hours ?? stats.hours ?? 0) || 0
    const gioPlus = Number(extra.gioPlus ?? 0) || 0
    const timing = calculateAttendanceTiming({
      employee: sysEmp,
      log: extra,
      checkIn: checkInStr,
      checkOut: checkOutStr,
      attendanceSettings
    })
    const dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

    return {
      employeeId: sysEmp.id,
      employeeCode:
        extra.employeeCode ||
        sysEmp._sourceEmployeeCode ||
        sysEmp.employeeId ||
        sysEmp.username ||
        '',
      employeeName:
        extra.employeeName ||
        sysEmp._sourceEmployeeName ||
        sysEmp.ho_va_ten ||
        sysEmp.name ||
        '',
      sourceEmployeeCode:
        sysEmp._sourceEmployeeCode ||
        extra.employeeCode ||
        sysEmp.employeeId ||
        '',
      sourceEmployeeName:
        sysEmp._sourceEmployeeName ||
        extra.employeeName ||
        sysEmp.ho_va_ten ||
        sysEmp.name ||
        '',
      machineName:
        extra.machineName ||
        sysEmp._sourceEmployeeName ||
        extra.employeeName ||
        sysEmp.ho_va_ten ||
        sysEmp.name ||
        '',
      tenTheoMayChamCong:
        extra.machineName ||
        sysEmp._sourceEmployeeName ||
        extra.employeeName ||
        sysEmp.ho_va_ten ||
        sysEmp.name ||
        '',
      department: extra.department || sysEmp.bo_phan || '',
      position: extra.position || sysEmp.vi_tri || '',
      date: dateStr,
      dayOfWeek: extra.dayOfWeek || dayNames[baseDate.getDay()] || '',
      timestamp: baseDate.getTime(),
      checkIn: checkInDate ? checkInDate.toISOString() : null,
      checkOut: checkOutDate ? checkOutDate.toISOString() : null,
      vao: checkInStr,
      ra: checkOutStr,
      cong: Number(extra.cong ?? (hours >= 8 ? 1 : hours > 0 ? 0.5 : 0)) || 0,
      hours,
      gio: hours,
      congPlus: Number(extra.congPlus ?? 0) || 0,
      gioPlus,
      lateMinutes: timing.lateMinutes ?? 0,
      earlyMinutes: timing.earlyMinutes ?? 0,
      vaoTre: timing.lateMinutes ?? 0,
      raSom: timing.earlyMinutes ?? 0,
      tc1: Number(extra.tc1 ?? 0) || 0,
      tc2: Number(extra.tc2 ?? 0) || 0,
      tc3: Number(extra.tc3 ?? 0) || 0,
      shiftName: extra.shiftName || '',
      tenCa: extra.shiftName || '',
      kyHieu: extra.kyHieu || stats.status || '',
      kyHieuPlus: extra.kyHieuPlus || '',
      tongGio: Number(extra.tongGio ?? hours + gioPlus) || 0,
      status: extra.kyHieu || stats.status || '',
      punches: stats.punches || []
    }
  }

  /** Format đầy đủ theo bảng chấm công công ty */
  const processFullAttendanceFormat = (jsonData, headers, headerRowIdx) => {
    const idxOf = (...keys) => headers.findIndex(h => keys.some(k => h.includes(k)))
    const codeIdx = idxOf('mã n', 'ma n', 'mã nv', 'ma nv', 'employee')
    const nameIdx = idxOf('tên nhân', 'ten nhan', 'họ tên', 'ho ten', 'tên nv')
    const machineNameIdx = idxOf('tên theo máy', 'ten theo may', 'tên máy', 'ten may', 'tên chấm công', 'ten cham cong')
    const deptIdx = idxOf('phòng ban', 'phong ban')
    const posIdx = idxOf('chức vụ', 'chuc vu')
    const dateIdx = idxOf('ngày', 'ngay')
    const thuIdx = idxOf('thứ', 'thu')
    const punchColumns = findAttendancePunchColumns(headers)
    const congIdx = headers.findIndex(h => h === 'công' || h === 'cong')
    const gioIdx = headers.findIndex(h => h === 'giờ' || h === 'gio')
    const congPlusIdx = idxOf('công+', 'cong+')
    const gioPlusIdx = idxOf('giờ+', 'gio+')
    const tc1Idx = headers.findIndex(h => h === 'tc1')
    const tc2Idx = headers.findIndex(h => h === 'tc2')
    const tc3Idx = headers.findIndex(h => h === 'tc3')
    const caIdx = idxOf('tên ca', 'ten ca')
    const kyIdx = headers.findIndex(h => h === 'kí hiệu' || h === 'ki hieu' || h === 'ký hiệu')
    const kyPlusIdx = idxOf('kí hiệu+', 'ki hieu+', 'ký hiệu+')
    const tongIdx = idxOf('tổng giờ', 'tong gio')

    const logs = []
    const skipped = []
    const num = (v) => {
      const n = parseFloat(String(v ?? '').replace(',', '.'))
      return isNaN(n) ? 0 : n
    }

    for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
      const row = jsonData[i]
      const empCode = codeIdx >= 0 ? row[codeIdx] : ''
      const empName = nameIdx >= 0 ? row[nameIdx] : ''
      const machineName = machineNameIdx >= 0 ? row[machineNameIdx] : ''
      const dateRaw = dateIdx >= 0 ? row[dateIdx] : ''
      if ((!empCode && !empName) || (dateRaw === '' || dateRaw == null)) continue

      const sysEmp = attachSourceIdentity(
        findEmployee(empCode, empName) || buildFallbackEmployee(empCode, empName, i),
        empCode,
        empName
      )

      const dateStr = parseDateValue(dateRaw)
      if (!dateStr) continue

      const rowContext = {
        department: deptIdx >= 0 ? String(row[deptIdx] || '') : '',
        position: posIdx >= 0 ? String(row[posIdx] || '') : '',
        shiftName: caIdx >= 0 ? String(row[caIdx] || '') : ''
      }

      const { checkIn: vao, checkOut: ra, punches } =
        collectAttendancePunches(row, punchColumns, parseTime)
      let stats
      if (vao && ra) {
        stats = { ...calculateStats([vao, ra], sysEmp, rowContext), punches }
      } else if (vao) {
        stats = { ...calculateStats([vao], sysEmp, rowContext), punches }
      } else if (ra) {
        stats = {
          checkIn: null,
          checkOut: ra,
          hours: 0,
          status: 'Thiếu vào',
          lateMinutes: 0,
          earlyMinutes: 0,
          punches
        }
      } else {
        stats = {
          checkIn: null,
          checkOut: null,
          hours: num(row[gioIdx]),
          status: 'Đủ',
          lateMinutes: 0,
          earlyMinutes: 0,
          punches: []
        }
      }

      logs.push(buildLog(sysEmp, dateStr, stats, {
        employeeCode: String(empCode || sysEmp.employeeId || ''),
        employeeName: String(empName || sysEmp.ho_va_ten || ''),
        machineName: String(machineName || empName || sysEmp.ho_va_ten || ''),
        department: rowContext.department,
        position: rowContext.position,
        dayOfWeek: thuIdx >= 0 ? String(row[thuIdx] || '') : '',
        vao,
        ra,
        cong: congIdx >= 0 ? num(row[congIdx]) : undefined,
        hours: gioIdx >= 0 ? num(row[gioIdx]) : undefined,
        congPlus: congPlusIdx >= 0 ? num(row[congPlusIdx]) : 0,
        gioPlus: gioPlusIdx >= 0 ? num(row[gioPlusIdx]) : 0,
        tc1: tc1Idx >= 0 ? num(row[tc1Idx]) : 0,
        tc2: tc2Idx >= 0 ? num(row[tc2Idx]) : 0,
        tc3: tc3Idx >= 0 ? num(row[tc3Idx]) : 0,
        shiftName: rowContext.shiftName,
        kyHieu: kyIdx >= 0 ? String(row[kyIdx] || '') : '',
        kyHieuPlus: kyPlusIdx >= 0 ? String(row[kyPlusIdx] || '') : '',
        tongGio: tongIdx >= 0 ? num(row[tongIdx]) : undefined
      }))
    }

    return { logs, skipped }
  }

  /** Format mới: Mã NV | Tên NV | Phòng ban | Ngày | Lần 1 ... Lần 7 */
  const processPunchLogFormat = (jsonData, headers, headerRowIdx) => {
    const codeIdx = headers.findIndex(h =>
      h.includes('mã nv') || h === 'mã' || h.includes('ma nv') || h === 'code' || h === 'id nv'
    )
    const nameIdx = headers.findIndex(h =>
      h.includes('tên nv') || h.includes('ho ten') || h.includes('họ tên') || h.includes('họ và tên') || h === 'tên'
    )
    const dateIdx = headers.findIndex(h => h.includes('ngày') || h.includes('ngay') || h === 'date')

    const lanIndexes = []
    headers.forEach((h, idx) => {
      if (/^l[aầ]n\s*\d+$/i.test(h) || h.includes('lần') || /^lan\s*\d+$/i.test(h)) {
        lanIndexes.push(idx)
      }
    })

    // Fallback: any column after Ngày that looks like punch columns
    if (lanIndexes.length === 0 && dateIdx >= 0) {
      for (let i = dateIdx + 1; i < headers.length; i++) {
        const h = headers[i]
        if (!h) continue
        if (h.includes('phòng') || h.includes('bộ phận') || h.includes('ghi chú')) continue
        lanIndexes.push(i)
      }
    }

    const logs = []
    const skipped = []

    for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
      const row = jsonData[i]
      if (!row || row.length === 0) continue

      const empCode = codeIdx >= 0 ? row[codeIdx] : ''
      const empName = nameIdx >= 0 ? row[nameIdx] : ''
      const dateRaw = dateIdx >= 0 ? row[dateIdx] : ''

      if (!empCode && !empName) continue
      if (!dateRaw && dateRaw !== 0) continue

      const times = []
      lanIndexes.forEach(idx => {
        const parsed = parseTime(row[idx])
        if (parsed) times.push(parsed.str)
      })

      // Row without any punch times = skip (not absent day unless needed)
      if (times.length === 0) continue

      const dateStr = parseDateValue(dateRaw)
      if (!dateStr) {
        skipped.push(`Dòng ${i + 1}: ngày không hợp lệ (${dateRaw})`)
        continue
      }

      const sysEmp = attachSourceIdentity(
        findEmployee(empCode, empName) || buildFallbackEmployee(empCode, empName, i),
        empCode,
        empName
      )

      const stats = calculateStats(times, sysEmp)
      if (stats) {
        logs.push(buildLog(sysEmp, dateStr, stats, {
          employeeCode: String(empCode || sysEmp.employeeId || ''),
          employeeName: String(empName || sysEmp.ho_va_ten || ''),
          machineName: String(empName || sysEmp.ho_va_ten || '')
        }))
      }
    }

    return { logs, skipped }
  }

  const processMatrixFormat = (jsonData, headers, headerRowIdx, year, month) => {
    const mergedData = {}
    const nameColIdx = headers.findIndex(h =>
      String(h).includes('họ tên') || String(h).includes('tên') || String(h).includes('name')
    )
    const codeColIdx = headers.findIndex(h =>
      String(h).includes('mã') || String(h).includes('code')
    )

    const dateCols = []
    headers.forEach((h, idx) => {
      const valStr = String(h).trim()
      if (valStr && /^\d{1,2}$/.test(valStr)) {
        const val = Number(valStr)
        if (val >= 1 && val <= 31) dateCols.push({ day: val, idx })
      }
    })

    let currentSysEmp = null

    for (let r = headerRowIdx + 1; r < jsonData.length; r++) {
      const row = jsonData[r]
      if (!row || row.length === 0) continue

      const empName = nameColIdx >= 0 ? row[nameColIdx] : ''
      const empCode = codeColIdx >= 0 ? row[codeColIdx] : ''

      if (empName || empCode) {
        currentSysEmp = attachSourceIdentity(
          findEmployee(empCode, empName) || buildFallbackEmployee(empCode, empName, r),
          empCode,
          empName
        )
      }
      if (!currentSysEmp) continue

      dateCols.forEach(({ day, idx }) => {
        const cellContent = row[idx]
        if (!cellContent || String(cellContent).trim() === '') return

        const cellStr = String(cellContent).trim()
        const extractedTimes = []
        const timeMatches = cellStr.match(/(\d{1,2}:\d{2})/g)
        if (timeMatches) extractedTimes.push(...timeMatches)

        if (extractedTimes.length === 0) {
          const parsed = parseTime(cellContent)
          if (parsed) extractedTimes.push(parsed.str)
        }

        if (extractedTimes.length > 0) {
          const key = `${currentSysEmp.id}_${day}`
          if (!mergedData[key]) {
            mergedData[key] = { emp: currentSysEmp, day, times: [] }
          }
          mergedData[key].times.push(...extractedTimes)
        }
      })
    }

    const logs = []
    Object.values(mergedData).forEach(item => {
      const { emp, day, times } = item
      if (!times || times.length === 0) return
      const stats = calculateStats(times, emp)
      if (!stats) return

      const dateObj = new Date(year, month - 1, day)
      if (dateObj.getMonth() !== month - 1) return
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      logs.push(buildLog(emp, dateStr, stats))
    })

    return { logs, skipped: [] }
  }

  const processListFormat = (jsonData, headers, headerRowIdx) => {
    const codeIdx = headers.findIndex(h => h.includes('mã') || h.includes('code') || h.includes('nv'))
    const nameIdx = headers.findIndex(h => h.includes('tên') || h.includes('name'))
    const dateIdx = headers.findIndex(h => h.includes('ngày') || h.includes('date'))
    const inIdx = headers.findIndex(h => h.includes('giờ vào') || h.includes('check-in') || h.includes('checkin') || h.includes('vào'))
    const outIdx = headers.findIndex(h => h.includes('giờ ra') || h.includes('check-out') || h.includes('checkout') || h.includes('ra'))
    const timeIdx = headers.findIndex(h => h.includes('giờ') || h.includes('time'))

    const logs = []
    const groupedData = {}
    const skipped = []

    for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
      const row = jsonData[i]
      const empCode = codeIdx >= 0 ? row[codeIdx] : ''
      const empName = nameIdx >= 0 ? row[nameIdx] : ''
      const dateRaw = dateIdx >= 0 ? row[dateIdx] : ''
      if ((!empCode && !empName) || (!dateRaw && dateRaw !== 0)) continue

      const key = `${empCode}_${empName}_${dateRaw}`
      if (!groupedData[key]) groupedData[key] = { empCode, empName, dateRaw, times: [] }

      if (inIdx >= 0) {
        const t = parseTime(row[inIdx])
        if (t) groupedData[key].times.push(t.str)
      }
      if (outIdx >= 0) {
        const t = parseTime(row[outIdx])
        if (t) groupedData[key].times.push(t.str)
      }
      if (inIdx < 0 && outIdx < 0 && timeIdx >= 0) {
        const t = parseTime(row[timeIdx])
        if (t) groupedData[key].times.push(t.str)
      }
    }

    for (const key in groupedData) {
      const group = groupedData[key]
      if (group.times.length === 0) continue

      const sysEmp = attachSourceIdentity(
        findEmployee(group.empCode, group.empName) ||
          buildFallbackEmployee(group.empCode, group.empName),
        group.empCode,
        group.empName
      )

      const dateStr = parseDateValue(group.dateRaw)
      if (!dateStr) continue

      const stats = calculateStats(group.times, sysEmp)
      if (stats) {
        logs.push(buildLog(sysEmp, dateStr, stats, {
          employeeCode: String(group.empCode || sysEmp.employeeId || ''),
          employeeName: String(group.empName || sysEmp.ho_va_ten || ''),
          machineName: String(group.empName || sysEmp.ho_va_ten || '')
        }))
      }
    }

    return { logs, skipped }
  }

  const detectFormat = (headers) => {
    const hasFull =
      headers.some(h => h.includes('công+') || h.includes('cong+') || h === 'tc1' || h.includes('kí hiệu') || h.includes('tổng giờ') || h.includes('chức vụ'))
    const hasLan = headers.some(h => /l[aầ]n\s*\d+/i.test(h) || h.startsWith('lần') || h.startsWith('lan '))
    const hasNgay = headers.some(h => h.includes('ngày') || h.includes('ngay') || h === 'date')
    const hasDayCols = headers.some(h => /^\d{1,2}$/.test(String(h).trim()) && Number(h) >= 1 && Number(h) <= 31)

    if (hasFull && hasNgay) return 'full'
    if (hasLan && hasNgay) return 'punch'
    if (hasDayCols) return 'matrix'
    return 'list'
  }

  const prepareMatchingPreview = (
    logs,
    metadata = {},
    preserveExistingMatches = false
  ) => {
    const groups = new Map()

    // Tự động ghi nhớ các ánh xạ nhân viên đã từng được ghép trong attendanceLogs
    const previousMatchFromLogs = new Map()
    attendanceLogs.forEach(item => {
      const sCode = item.sourceEmployeeCode || item.employeeCode || ''
      const sName = item.sourceEmployeeName || item.employeeName || item.machineName || ''
      if ((sCode || sName) && item.employeeId && !String(item.employeeId).startsWith('external:')) {
        const sKey = buildSourceEmployeeKey(sCode, sName)
        const emp = employeesById.get(String(item.employeeId))
        if (emp && !previousMatchFromLogs.has(sKey)) {
          previousMatchFromLogs.set(sKey, emp)
        }
      }
    })

    logs.forEach(log => {
      const sourceCode =
        log.sourceEmployeeCode ||
        log.employeeCode ||
        ''
      const sourceName =
        log.sourceEmployeeName ||
        log.employeeName ||
        log.machineName ||
        log.tenTheoMayChamCong ||
        ''
      const sourceKey = buildSourceEmployeeKey(sourceCode, sourceName)

      if (!groups.has(sourceKey)) {
        const rememberedEmployee = previousMatchFromLogs.get(sourceKey)
        const currentEmployee = preserveExistingMatches
          ? employeesById.get(String(log.employeeId))
          : (rememberedEmployee || null)
        const smartMatch = currentEmployee
          ? {
              employee: currentEmployee,
              suggestedEmployee: currentEmployee,
              confidence: 1,
              gap: 1,
              method: rememberedEmployee ? 'Đã ghi nhớ từ lần ghép trước' : 'Đã gắn với hồ sơ Lumi',
              status: 'matched',
              candidates: [{ employee: currentEmployee, score: 1 }]
            }
          : matchAttendanceEmployee(
              sourceCode,
              sourceName,
              employees,
              matchBranch
            )

        groups.set(sourceKey, {
          key: sourceKey,
          sourceCode: String(sourceCode || '').trim(),
          sourceName: String(sourceName || '').replace(/\s+/g, ' ').trim(),
          rowCount: 0,
          selectedEmployeeId: smartMatch.employee?.id || '',
          suggestedEmployeeId: smartMatch.suggestedEmployee?.id || '',
          confidence: smartMatch.confidence,
          gap: smartMatch.gap,
          method: smartMatch.method,
          status: smartMatch.status,
          candidates: smartMatch.candidates
        })
      }

      groups.get(sourceKey).rowCount += 1
    })

    const matchGroups = Array.from(groups.values())
    const groupByKey = new Map(matchGroups.map(group => [group.key, group]))
    const matchedLogs = logs.map(log => {
      const sourceCode = log.sourceEmployeeCode || log.employeeCode || ''
      const sourceName =
        log.sourceEmployeeName ||
        log.employeeName ||
        log.machineName ||
        log.tenTheoMayChamCong ||
        ''
      const sourceKey = buildSourceEmployeeKey(sourceCode, sourceName)
      const group = groupByKey.get(sourceKey)
      const selectedEmployee = employeesById.get(String(group?.selectedEmployeeId))
      const preparedLog = {
        ...log,
        sourceEmployeeCode: sourceCode,
        sourceEmployeeName: sourceName,
        _sourceEmployeeKey: sourceKey,
        _originalEmployeeId: log.employeeId || '',
        _sourceDepartment: log.department || log.phongBan || '',
        _sourcePosition: log.position || log.chucVu || ''
      }

      return selectedEmployee
        ? applyCalculatedAttendanceTiming(
            applyEmployeeToAttendanceLog(preparedLog, selectedEmployee),
            selectedEmployee,
            attendanceSettings
          )
        : preparedLog
    })

    return {
      ...metadata,
      count: matchedLogs.length,
      uniqueEmployeeCount: matchGroups.length,
      matchGroups,
      logs: matchedLogs
    }
  }

  const handleMatchChange = (sourceKey, employeeId, method = 'Người dùng xác nhận') => {
    setPreviewData(previous => {
      if (!previous) return previous
      const isSkipped = employeeId === '__skip__'
      const selectedEmployee = employeesById.get(String(employeeId))
      const matchGroups = previous.matchGroups.map(group =>
        group.key === sourceKey
          ? {
              ...group,
              selectedEmployeeId: isSkipped ? '__skip__' : selectedEmployee?.id || '',
              confidence: selectedEmployee ? 1 : group.confidence,
              method: isSkipped
                ? 'Không có hồ sơ trong Lumi - bỏ qua'
                : selectedEmployee
                  ? method
                  : group.method,
              status: isSkipped
                ? 'skipped'
                : selectedEmployee
                  ? 'matched'
                  : group.status
            }
          : group
      )

      const logs = previous.logs.map(log => {
        if (log._sourceEmployeeKey !== sourceKey) return log
        if (selectedEmployee) {
          return applyCalculatedAttendanceTiming(
            applyEmployeeToAttendanceLog(log, selectedEmployee),
            selectedEmployee,
            attendanceSettings
          )
        }

        return {
          ...log,
          employeeId: `external:${sourceKey}`,
          employeeCode: log.sourceEmployeeCode || '',
          employeeName: log.sourceEmployeeName || '',
          department: log._sourceDepartment || '',
          position: log._sourcePosition || ''
        }
      })

      return { ...previous, matchGroups, logs }
    })
  }

  const handleReconcileExisting = () => {
    if (!attendanceLogs.length) {
      alert('Chưa có dữ liệu chấm công trong Lumi để đối soát.')
      return
    }

    setPreviewData(
      prepareMatchingPreview(
        attendanceLogs,
        {
          modeLabel: 'Đối soát dữ liệu đã có trong Lumi',
          isMatrixMode: false,
          detectedDays: [],
          skipped: [],
          isReconcileMode: true
        },
        true
      )
    )
  }

  const readFileAsDataUrl = (imageFile) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('Không đọc được ảnh danh sách nhân sự'))
      reader.readAsDataURL(imageFile)
    })

  const handleAiMatch = async () => {
    if (!previewData?.matchGroups?.length) return
    const pendingGroups = previewData.matchGroups.filter(
      group => !group.selectedEmployeeId
    )
    if (!pendingGroups.length) {
      alert('Tất cả nhân viên đã được ghép. Không cần gọi AI.')
      return
    }
    if (!referenceImage) {
      alert('Vui lòng chọn ảnh danh sách nhân sự để AI đọc và đối sánh.')
      return
    }
    if (referenceImage.size > 3 * 1024 * 1024) {
      alert('Ảnh vượt quá 3MB. Vui lòng giảm kích thước ảnh.')
      return
    }

    setAiLoading(true)
    try {
      const imageDataUrl = await readFileAsDataUrl(referenceImage)
      const response = await fetch('/api/attendance-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl,
          branch: matchBranch,
          sourcePeople: pendingGroups.map(group => ({
            sourceKey: group.key,
            sourceCode: group.sourceCode,
            sourceName: group.sourceName
          })),
          employees: employees.map(employee => ({
            id: employee.id,
            employeeCode:
              employee.employeeId ||
              employee.employee_id ||
              employee.username ||
              '',
            name: employee.ho_va_ten || employee.name || '',
            branch: employee.chi_nhanh || employee.branch || '',
            department: employee.bo_phan || employee.department || ''
          }))
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'AI không xử lý được ảnh')
      }

      ;(payload.matches || []).forEach(match => {
        if (
          match?.sourceKey &&
          match?.employeeId &&
          employeesById.has(String(match.employeeId))
        ) {
          handleMatchChange(
            match.sourceKey,
            match.employeeId,
            `AI xác nhận: ${match.reason || 'khớp theo ảnh'}`
          )
        }
      })
    } catch (error) {
      alert(`Không thể dùng AI: ${error.message}`)
    } finally {
      setAiLoading(false)
    }
  }

  const handlePreview = async () => {
    if (!file) {
      alert('Vui lòng chọn file Excel')
      return
    }

    setLoading(true)
    try {
      const data = await file.arrayBuffer()
      const workbook = read(data)
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      // raw:true to keep Excel time serials; also keep strings
      const jsonData = utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' })

      let headerRowIdx = -1
      let headers = []

      for (let i = 0; i < Math.min(jsonData.length, 15); i++) {
        const row = jsonData[i] || []
        const lower = row.map(c => String(c || '').toLowerCase().trim())
        const rowStr = lower.join(' ')
        if (
          (rowStr.includes('mã nv') && rowStr.includes('ngày')) ||
          (rowStr.includes('ma nv') && rowStr.includes('ngay')) ||
          (rowStr.includes('họ tên') || rowStr.includes('tên nv')) ||
          (rowStr.includes('mã') && rowStr.includes('ngày')) ||
          lower.some(h => /l[aầ]n\s*\d+/i.test(h))
        ) {
          headerRowIdx = i
          headers = lower
          break
        }
      }

      if (headerRowIdx === -1) {
        throw new Error('Không tìm thấy dòng tiêu đề hợp lệ (cần Mã NV, Ngày, Lần 1...)')
      }

      const format = detectFormat(headers)
      let result = { logs: [], skipped: [] }
      let detectedDays = []
      let modeLabel = 'Danh sách'

      if (format === 'full') {
        result = processFullAttendanceFormat(jsonData, headers, headerRowIdx)
        modeLabel = 'Bảng chấm công đầy đủ'
      } else if (format === 'punch') {
        result = processPunchLogFormat(jsonData, headers, headerRowIdx)
        modeLabel = 'Nhật ký chấm công (Lần 1–7)'
      } else if (format === 'matrix') {
        const [year, month] = importMonth.split('-').map(Number)
        headers.forEach((h) => {
          const trimmedH = String(h).trim()
          if (/^\d{1,2}$/.test(trimmedH)) {
            const val = Number(trimmedH)
            if (val >= 1 && val <= 31) detectedDays.push(val)
          }
        })
        detectedDays.sort((a, b) => a - b)
        result = processMatrixFormat(jsonData, headers, headerRowIdx, year, month)
        modeLabel = 'Bảng công (Ma trận ngày)'
      } else {
        result = processListFormat(jsonData, headers, headerRowIdx)
        modeLabel = 'Danh sách (Vào/Ra)'
      }

      if (result.logs.length === 0) {
        const hint = result.skipped.slice(0, 5).join('\n')
        alert(`Không tìm thấy dữ liệu hợp lệ.\n${hint || 'Vui lòng kiểm tra lại file và mã NV khớp hệ thống.'}`)
        setPreviewData(null)
      } else {
        setPreviewData(
          prepareMatchingPreview(result.logs, {
            modeLabel,
            isMatrixMode: format === 'matrix',
            detectedDays,
            skipped: result.skipped,
            isReconcileMode: false
          })
        )
      }
    } catch (error) {
      alert('Lỗi: ' + error.message)
      console.error(error)
      setPreviewData(null)
    } finally {
      setLoading(false)
    }
  }

  const executeImport = async () => {
    if (!previewData || !previewData.logs) return
    const unresolvedCount = previewData.matchGroups.filter(
      group => !group.selectedEmployeeId && group.status !== 'skipped'
    ).length
    if (
      unresolvedCount > 0 &&
      !confirm(
        `Còn ${unresolvedCount} nhân viên chưa được ghép với hồ sơ Lumi.\n` +
        'Các dòng này sẽ được lưu theo mã và tên trong file chấm công để không mất dữ liệu. Bạn có muốn tiếp tục?'
      )
    ) {
      return
    }

    setLoading(true)
    try {
      const BATCH_SIZE = 50
      let count = 0
      let skippedCount = 0
      const sanitizeLog = (log) =>
        Object.fromEntries(
          Object.entries(log).filter(([key]) => key !== 'id' && !key.startsWith('_'))
        )

      if (previewData.isReconcileMode) {
        const changedLogs = previewData.logs.filter(
          log =>
            log.id &&
            String(log.employeeId || '') !== String(log._originalEmployeeId || '')
        )

        for (let i = 0; i < changedLogs.length; i += BATCH_SIZE) {
          const chunk = changedLogs.slice(i, i + BATCH_SIZE)
          await Promise.all(
            chunk.map(log =>
              fbUpdate(`hr/attendanceLogs/${log.id}`, sanitizeLog(log))
            )
          )
          count += chunk.length
        }
      } else {
        const existingMap = new Map()
        attendanceLogs.forEach(log => {
          const key = buildAttendanceRecordKey(log)
          existingMap.set(key, log)
        })

        const importKeys = new Set()
        const skippedSourceKeys = new Set(
          previewData.matchGroups
            .filter(group => group.status === 'skipped')
            .map(group => group.key)
        )

        const logsToInsert = []
        const logsToUpdate = []

        previewData.logs.forEach(log => {
          if (skippedSourceKeys.has(log._sourceEmployeeKey)) {
            skippedCount += 1
            return
          }
          const key = buildAttendanceRecordKey(log)
          if (importKeys.has(key)) {
            skippedCount += 1
            return
          }
          importKeys.add(key)

          const existing = existingMap.get(key)
          if (existing && existing.id) {
            const nextData = sanitizeLog(log)
            const hasChanged = Object.entries(nextData).some(([field, value]) =>
              JSON.stringify(existing[field] ?? null) !== JSON.stringify(value ?? null)
            )
            if (hasChanged) {
              logsToUpdate.push({ id: existing.id, data: nextData })
            } else {
              skippedCount += 1
            }
          } else {
            logsToInsert.push(log)
          }
        })

        for (let i = 0; i < logsToUpdate.length; i += BATCH_SIZE) {
          const chunk = logsToUpdate.slice(i, i + BATCH_SIZE)
          await Promise.all(
            chunk.map(item => fbUpdate(`hr/attendanceLogs/${item.id}`, item.data))
          )
        }

        for (let i = 0; i < logsToInsert.length; i += BATCH_SIZE) {
          const chunk = logsToInsert.slice(i, i + BATCH_SIZE)
          await Promise.all(
            chunk.map(log => fbPush('hr/attendanceLogs', sanitizeLog(log)))
          )
          count += chunk.length
        }

        const updateMsg = logsToUpdate.length ? ` Cập nhật lại ${logsToUpdate.length} dòng theo nhân sự mới chọn.` : ''
        alert(
          `Đã import ${count} dòng mới.${updateMsg}` +
          `${unresolvedCount ? ` ${unresolvedCount} nhân viên được giữ theo mã/tên nguồn để đối soát sau.` : ''}` +
          `${skippedCount ? ` Bỏ qua ${skippedCount} dòng đã có.` : ''}`
        )
      }
      await onSave()
      onClose()
      setFile(null)
      setReferenceImage(null)
      setPreviewData(null)
    } catch (error) {
      alert('Lỗi khi lưu dữ liệu: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const formatExportTime = value => formatAttendanceTime(value) || String(value || '')

  const downloadMatchedExcel = () => {
    if (!previewData?.logs?.length) return
    const groupByKey = new Map(
      previewData.matchGroups.map(group => [group.key, group])
    )
    const skippedSourceKeys = new Set(
      previewData.matchGroups
        .filter(group => group.status === 'skipped')
        .map(group => group.key)
    )
    const rows = previewData.logs
      .filter(log => !skippedSourceKeys.has(log._sourceEmployeeKey))
      .map((log, index) => {
      const group = groupByKey.get(log._sourceEmployeeKey)
      return {
        STT: index + 1,
        'Mã nguồn': log.sourceEmployeeCode || '',
        'Tên nguồn': log.sourceEmployeeName || '',
        'Mã N.Viên Lumi': log.employeeCode || '',
        'Tên nhân viên Lumi': log.employeeName || '',
        'Tên theo máy chấm công':
          log.machineName || log.tenTheoMayChamCong || '',
        'Phòng ban': log.department || '',
        'Chức vụ': log.position || '',
        'Ngày': String(log.date || '').slice(0, 10),
        'Thứ': log.dayOfWeek || '',
        'Vào': formatExportTime(log.vao || log.checkIn),
        'Ra': formatExportTime(log.ra || log.checkOut),
        'Công': log.cong ?? '',
        'Giờ': log.hours ?? log.gio ?? '',
        'Công+': log.congPlus ?? '',
        'Giờ+': log.gioPlus ?? '',
        'Vào trễ': log.lateMinutes ?? log.vaoTre ?? '',
        'Ra sớm': log.earlyMinutes ?? log.raSom ?? '',
        TC1: log.tc1 ?? '',
        TC2: log.tc2 ?? '',
        TC3: log.tc3 ?? '',
        'Tên ca': log.shiftName || log.tenCa || '',
        'Kí hiệu': log.kyHieu || log.status || '',
        'Kí hiệu+': log.kyHieuPlus || '',
        'Tổng giờ': log.tongGio ?? '',
        'Độ tin cậy': group ? `${Math.round(group.confidence * 100)}%` : '',
        'Cách đối sánh': group?.method || ''
      }
      })
    const worksheet = utils.json_to_sheet(rows)
    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, worksheet, 'ChamCongDaKhop')
    writeFile(
      workbook,
      `Cham_cong_da_khop_${importMonth || new Date().toISOString().slice(0, 7)}.xlsx`
    )
  }

  const downloadNewTemplate = () => {
    const headers = [
      'Mã N.Viên', 'Tên nhân viên', 'Tên theo máy chấm công', 'Phòng ban', 'Chức vụ', 'Ngày', 'Thứ',
      'Vào', 'Ra', 'Công', 'Giờ', 'Công+', 'Giờ+', 'Vào trễ', 'Ra sớm',
      'TC1', 'TC2', 'TC3', 'Tên ca', 'Kí hiệu', 'Kí hiệu+', 'Tổng giờ'
    ]
    const sample = [
      ['NV001', 'Nguyễn Văn A', 'Nguyen Van A', 'Kế toán', 'Nhân viên', '2026-05-01', 'Thứ 6', '08:00', '17:30', 1, 8, 0, 0, 0, 0, 0, 0, 0, 'Ca full', 'X', '', 8],
      ['NV001', 'Nguyễn Văn A', 'Nguyen Van A', 'Kế toán', 'Nhân viên', '2026-05-02', 'Thứ 7', '07:55', '17:35', 1, 8, 0.5, 1, 0, 0, 0, 0, 0, 'Ca full', 'X', 'TC', 9]
    ]
    const ws = utils.aoa_to_sheet([headers, ...sample])
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'ChamCong')
    writeFile(wb, 'Mau_nhap_cham_cong.xlsx')
  }

  const handleClose = () => {
    setFile(null)
    setReferenceImage(null)
    setPreviewData(null)
    onClose()
  }

  if (!isOpen) return null

  const matchedEmployeeCount =
    previewData?.matchGroups?.filter(
      group => group.selectedEmployeeId && group.status !== 'skipped'
    ).length || 0
  const skippedEmployeeCount =
    previewData?.matchGroups?.filter(group => group.status === 'skipped').length || 0
  const unresolvedEmployeeCount =
    (previewData?.matchGroups?.length || 0) -
    matchedEmployeeCount -
    skippedEmployeeCount

  return (
    <div className="modal show" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1100px' }}>
        <div className="modal-header">
          <h3>
            <i className="fas fa-robot"></i>
            AI đối soát & Import chấm công
          </h3>
          <button className="modal-close" onClick={handleClose}>&times;</button>
        </div>
        <div className="modal-body">
          {!previewData ? (
            <>
              <div className="form-group">
                <label>Chi nhánh dùng để đối sánh nhân sự</label>
                <select
                  value={matchBranch}
                  onChange={(e) => setMatchBranch(e.target.value)}
                  style={{ width: '100%', padding: '10px', marginBottom: '12px' }}
                >
                  <option value="">Tất cả chi nhánh</option>
                  {availableBranches.map(branch => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Chọn tháng chấm công (dùng cho mẫu ma trận ngày) *</label>
                <input
                  type="month"
                  value={importMonth}
                  onChange={(e) => setImportMonth(e.target.value)}
                  style={{ width: '100%', marginBottom: '15px' }}
                />
              </div>
              <div className="form-group">
                <label>1. File Excel chấm công</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} style={{ width: '100%', padding: '10px' }} />
              </div>
              <div className="form-group">
                <label>2. Ảnh danh sách nhân sự (không bắt buộc)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setReferenceImage(e.target.files?.[0] || null)}
                  disabled={aiAvailable === false}
                  style={{ width: '100%', padding: '10px' }}
                />
                  <small style={{ color: '#6b7280' }}>
                  {aiAvailable === false
                    ? 'Chưa cấu hình GROQ_API_KEY trên production. Đối sánh tên/mã trong Excel vẫn hoạt động.'
                    : 'Dùng khi cần AI đọc ảnh danh sách nhân sự để hỗ trợ các tên khó ghép.'}
                </small>
              </div>
              <div style={{ marginTop: '-10px', marginBottom: '10px' }}>
                <button
                  type="button"
                  className="btn btn-link"
                  style={{ fontSize: '0.85rem', padding: 0 }}
                  onClick={downloadNewTemplate}
                >
                  <i className="fas fa-download"></i> Tải file mẫu (đầy đủ cột chấm công)
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '12px',
                  marginBottom: '12px',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  background: '#fffbeb'
                }}
              >
                <div>
                  <strong>Dữ liệu đã có trong Lumi</strong>
                  <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                    Đổi mã máy chấm công sang mã nhân viên chuẩn trong hồ sơ Lumi.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={handleReconcileExisting}
                  disabled={!attendanceLogs.length}
                >
                  <i className="fas fa-link"></i>
                  {` Khớp mã nhân viên (${attendanceLogs.length} dòng)`}
                </button>
              </div>
              <div className="alert alert-info" style={{ marginTop: '15px', background: '#e8f5e9', padding: '10px', borderRadius: '4px' }}>
                <small>
                  <strong>Quy tắc đối sánh:</strong><br />
                  • Mã máy và mã Lumi được giữ riêng; kết quả dùng mã nhân viên chuẩn của hồ sơ Lumi.<br />
                  • Ghép được tên có dấu/không dấu, viết liền, khác hoa thường và thiếu tên đệm phổ biến.<br />
                  • Tên chắc chắn được tự ghép; tên mơ hồ bắt buộc người dùng chọn lại trước khi ghi CSDL.<br />
                  • Hệ thống giữ tên/mã nguồn để kiểm tra và chống import trùng.
                </small>
              </div>
            </>
          ) : (
            <div style={{ padding: '10px', background: '#f8f9fa', borderRadius: '4px' }}>
              <h4>Kết quả phân tích:</h4>
              <ul>
                <li><strong>Chế độ:</strong> {previewData.modeLabel}</li>
                <li><strong>Số nhân viên (không trùng):</strong> {previewData.uniqueEmployeeCount}</li>
                <li><strong>Tổng số dòng chấm công:</strong> {previewData.count}</li>
                <li style={{ color: '#15803d' }}>
                  <strong>Đã ghép với Lumi:</strong> {matchedEmployeeCount}
                </li>
                <li style={{ color: unresolvedEmployeeCount ? '#b91c1c' : '#15803d' }}>
                  <strong>Cần kiểm tra:</strong> {unresolvedEmployeeCount}
                </li>
                {skippedEmployeeCount > 0 && (
                  <li style={{ color: '#6b7280' }}>
                    <strong>Không có hồ sơ Lumi, sẽ bỏ qua:</strong> {skippedEmployeeCount}
                  </li>
                )}
                {previewData.isMatrixMode && (
                  <li>
                    <strong>Các cột ngày tìm thấy:</strong>{' '}
                    <span style={{ color: '#007bff', fontWeight: 'bold' }}>
                      {previewData.detectedDays.join(', ')}
                    </span>
                  </li>
                )}
                {previewData.skipped?.length > 0 && (
                  <li style={{ color: '#b45309' }}>
                    <strong>Bỏ qua:</strong> {previewData.skipped.length} dòng
                    <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                      {previewData.skipped.slice(0, 5).map((s, i) => <div key={i}>{s}</div>)}
                    </div>
                  </li>
                )}
              </ul>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '10px'
                }}
              >
                <button
                  type="button"
                  className="btn btn-info"
                  onClick={handleAiMatch}
                  disabled={aiLoading || !referenceImage || aiAvailable === false}
                  title={
                    aiAvailable === false
                      ? 'Production chưa cấu hình GROQ_API_KEY'
                      : referenceImage
                        ? 'Dùng AI đọc ảnh và đối sánh mã/tên'
                        : 'Chọn ảnh danh sách nhân sự trước'
                  }
                >
                  <i className={`fas ${aiLoading ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                  {aiLoading ? ' AI đang đối sánh...' : ' AI đọc ảnh & khớp mã'}
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={downloadMatchedExcel}
                  disabled={unresolvedEmployeeCount > 0}
                >
                  <i className="fas fa-file-excel"></i>
                  {' Xuất Excel đã khớp'}
                </button>
              </div>

              <div style={{ marginTop: '10px' }}>
                <strong>Bảng khớp mã máy → mã nhân viên Lumi:</strong>
              </div>
              <div
                style={{
                  maxHeight: '300px',
                  overflow: 'auto',
                  marginTop: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  background: '#fff'
                }}
              >
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: '#eee', position: 'sticky', top: 0, zIndex: 2 }}>
                      <th style={{ padding: '6px' }}>Mã máy</th>
                      <th style={{ padding: '6px' }}>Tên từ máy/file</th>
                      <th style={{ padding: '6px' }}>Mã NV Lumi</th>
                      <th style={{ padding: '6px' }}>Hồ sơ Lumi</th>
                      <th style={{ padding: '6px' }}>Tin cậy</th>
                      <th style={{ padding: '6px' }}>Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.matchGroups.map(group => {
                      const suggestedEmployee = employeesById.get(String(group.suggestedEmployeeId))
                      const selectedEmployee = employeesById.get(String(group.selectedEmployeeId))
                      const statusColor = group.status === 'skipped'
                        ? '#6b7280'
                        : group.selectedEmployeeId
                          ? '#15803d'
                        : group.status === 'review'
                          ? '#b45309'
                          : '#b91c1c'
                      return (
                        <tr key={group.key} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '6px' }}>
                            <strong>{group.sourceCode || '-'}</strong>
                            <div style={{ color: '#6b7280' }}>{group.rowCount} dòng</div>
                          </td>
                          <td style={{ padding: '6px' }}>
                            <strong>{group.sourceName || '-'}</strong>
                          </td>
                          <td style={{ padding: '6px', color: selectedEmployee ? '#15803d' : '#b91c1c' }}>
                            <strong>
                              {selectedEmployee
                                ? getCanonicalEmployeeCode(selectedEmployee) || '-'
                                : group.status === 'skipped'
                                  ? 'Bỏ qua'
                                  : 'Chưa khớp'}
                            </strong>
                          </td>
                          <td style={{ padding: '6px', minWidth: '310px' }}>
                            <select
                              value={group.selectedEmployeeId}
                              onChange={(e) => handleMatchChange(group.key, e.target.value)}
                              style={{
                                width: '100%',
                                padding: '7px',
                                borderColor: group.selectedEmployeeId ? '#86efac' : '#fca5a5'
                              }}
                            >
                              <option value="">-- Chọn nhân viên Lumi --</option>
                              <option value="__skip__">-- Không có trong Lumi (bỏ qua) --</option>
                              {employeesForMatching.map(employee => (
                                <option key={employee.id} value={employee.id}>
                                  {employee.ho_va_ten || employee.name || employee.id}
                                  {employee.employeeId || employee.username
                                    ? ` (${employee.employeeId || employee.username})`
                                    : ''}
                                </option>
                              ))}
                            </select>
                            {!group.selectedEmployeeId && suggestedEmployee && (
                              <div style={{ color: '#b45309', marginTop: '3px' }}>
                                Gợi ý: {suggestedEmployee.ho_va_ten || suggestedEmployee.name}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                            {Math.round(group.confidence * 100)}%
                          </td>
                          <td style={{ padding: '6px', color: statusColor }}>
                            <strong>
                              {group.status === 'skipped'
                                ? 'Sẽ bỏ qua'
                                : group.selectedEmployeeId
                                  ? 'Đã ghép'
                                  : 'Cần chọn'}
                            </strong>
                            <div style={{ fontSize: '0.78rem' }}>{group.method}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: '10px' }}>
                <strong>Chi tiết chấm công sau đối sánh:</strong>
              </div>
              <div style={{ maxHeight: '260px', overflowY: 'auto', marginTop: '8px', fontSize: '0.85rem', border: '1px solid #ddd', borderRadius: '6px' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#eee' }}>
                      <th style={{ padding: '5px' }}>STT</th>
                      <th style={{ padding: '5px' }}>Mã NV</th>
                      <th style={{ padding: '5px' }}>Tên NV</th>
                      <th style={{ padding: '5px' }}>Tên máy chấm công</th>
                      <th style={{ padding: '5px' }}>Ngày</th>
                      <th style={{ padding: '5px' }}>Vào</th>
                      <th style={{ padding: '5px' }}>Ra</th>
                      <th style={{ padding: '5px' }}>Công</th>
                      <th style={{ padding: '5px' }}>Giờ</th>
                      <th style={{ padding: '5px' }}>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.logs.slice(0, 50).map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                        <td style={{ padding: '5px', textAlign: 'center' }}>{i + 1}</td>
                        <td style={{ padding: '5px' }}>{l.employeeCode || '-'}</td>
                        <td style={{ padding: '5px' }}>{l.employeeName || employees.find(e => e.id === l.employeeId)?.ho_va_ten || l.employeeId}</td>
                        <td style={{ padding: '5px' }}>{l.machineName || l.tenTheoMayChamCong || l.employeeName || '-'}</td>
                        <td style={{ padding: '5px' }}>{l.date}</td>
                        <td style={{ padding: '5px' }}>{formatExportTime(l.vao || l.checkIn) || '-'}</td>
                        <td style={{ padding: '5px' }}>{formatExportTime(l.ra || l.checkOut) || '-'}</td>
                        <td style={{ padding: '5px', textAlign: 'center' }}>{l.cong ?? '-'}</td>
                        <td style={{ padding: '5px' }}>{l.hours}</td>
                        <td style={{ padding: '5px' }}>{l.status}</td>
                      </tr>
                    ))}
                    {previewData.logs.length > 50 && (
                      <tr>
                        <td colSpan="10" style={{ textAlign: 'center', padding: '5px' }}>
                          ...và {previewData.logs.length - 50} dòng khác
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="form-actions" style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={handleClose}>Đóng</button>

            {!previewData ? (
              <button type="button" className="btn btn-primary" onClick={handlePreview} disabled={loading || !file}>
                {loading ? <><i className="fas fa-spinner fa-spin"></i> Đang đọc file...</> : 'Phân tích & khớp dữ liệu >'}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setPreviewData(null)}>{'< Quay lại'}</button>
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={executeImport}
                  disabled={loading}
                  title={
                    unresolvedEmployeeCount > 0
                      ? 'Nhân viên chưa ghép sẽ được giữ theo mã/tên nguồn để đối soát sau'
                      : ''
                  }
                >
                  {loading
                    ? <><i className="fas fa-spinner fa-spin"></i> Đang lưu...</>
                    : <><i className="fas fa-check"></i> {previewData.isReconcileMode ? 'Cập nhật CSDL Lumi' : 'Xác nhận Import'}</>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AttendanceImportModal
