import { buildSourceEmployeeKey } from './attendanceMatching.js'
import {
  applyCalculatedAttendanceTiming,
  attendanceTimeToMinutes,
  formatAttendanceTime,
  resolveAttendanceShift
} from './attendanceShift.js'
import {
  calculateAttendanceMetrics,
  getAttendanceHoliday,
  roundDecimal,
  STANDARD_WORK_MINUTES
} from './attendanceCalculations.js'

const numberValue = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const attendancePunchPairs = log => {
  if (Array.isArray(log?.punchPairs) && log.punchPairs.length) {
    return log.punchPairs
      .map(pair => ({
        checkIn: formatAttendanceTime(pair?.checkIn),
        checkOut: formatAttendanceTime(pair?.checkOut)
      }))
      .filter(pair => pair.checkIn || pair.checkOut)
  }
  const punches = Array.isArray(log?.punches)
    ? log.punches.map(formatAttendanceTime).filter(Boolean)
    : []
  if (punches.length < 4) return []
  const pairs = []
  for (let index = 0; index < punches.length; index += 2) {
    pairs.push({ checkIn: punches[index] || '', checkOut: punches[index + 1] || '' })
  }
  return pairs
}

export const attendanceDateString = (log) => {
  if (log?.date) return String(log.date).slice(0, 10)
  if (!log?.timestamp) return ''
  const date = new Date(log.timestamp)
  return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

const hasNumericValue = (value) =>
  value !== '' &&
  value !== null &&
  value !== undefined &&
  Number.isFinite(Number(value))

export const summarizeAttendanceDay = (logs, employee = {}, attendanceSettings = {}, date = '') => {
  let hours = 0
  let workdays = 0
  let extraWorkdays = 0
  let overtimeHours = 0
  let paidLeaveWorkdays = 0
  let lateMinutes = 0
  let earlyMinutes = 0
  let onlineWorkdays = 0
  let offlineWorkdays = 0
  let sourceHours = 0
  const actualPunches = []
  let hasSourceWorkday = false
  let hasPunch = false
  let missingPunch = false
  let unapprovedAbsence = false
  let checkIn = ''
  let checkOut = ''
  let shiftName = ''
  let calculationMode = 'full-day'
  let splitShiftBreakdown = []
  const sampleLog = logs[0] || {}
  const resolvedShift = resolveAttendanceShift(employee, sampleLog, attendanceSettings)
  const standardCheckIn = formatAttendanceTime(resolvedShift?.start || resolvedShift?.standardCheckIn)
  const standardCheckOut = formatAttendanceTime(resolvedShift?.end || resolvedShift?.standardCheckOut)

  logs.forEach(sourceLog => {
    const preservesSourceValues = ['source-value', 'matrix-value'].includes(sourceLog.calculationMode)
    const log = preservesSourceValues
      ? sourceLog
      : applyCalculatedAttendanceTiming(sourceLog, employee, attendanceSettings)
    const logHours = numberValue(log.hours ?? log.soGio ?? log.gio ?? log.tongGio ?? (
      numberValue(log.hours ?? log.soGio ?? log.gio) +
      numberValue(log.gioPlus)
    ))
    sourceHours += Math.max(0, logHours)
    const logCheckIn = formatAttendanceTime(log.checkIn || log.vao)
    const logCheckOut = formatAttendanceTime(log.checkOut || log.ra)
    const hasCheckIn = Boolean(logCheckIn)
    const hasCheckOut = Boolean(logCheckOut)
    const isSyntheticPunch = Boolean(log.syntheticPunch || log.isDerivedFromCode)
    const useSourceValues = ['source-value', 'matrix-value'].includes(log.calculationMode)
    if (useSourceValues) calculationMode = log.calculationMode
    if (!isSyntheticPunch) {
      lateMinutes += numberValue(log.lateMinutes ?? log.vaoTre)
      earlyMinutes += numberValue(log.earlyMinutes ?? log.raSom)
    }
    if (!isSyntheticPunch && !useSourceValues && hasCheckIn && hasCheckOut) {
      actualPunches.push({ checkIn: logCheckIn, checkOut: logCheckOut })
    }
    if (!isSyntheticPunch && hasCheckIn && (!checkIn || logCheckIn < checkIn)) checkIn = logCheckIn
    if (!isSyntheticPunch && hasCheckOut && (!checkOut || logCheckOut > checkOut)) checkOut = logCheckOut
    if (!shiftName) shiftName = log.shiftName || log.tenCa || resolvedShift?.name || ''
    const status = String(log.kyHieu || log.status || '').trim().toUpperCase()
    const logWorkdays =
      numberValue(log.cong) + numberValue(log.congPlus)
    const isSourcePaidLeave =
      !hasCheckIn &&
      !hasCheckOut &&
      numberValue(log.congPlus) > 0 &&
      String(log.kyHieuPlus || status).trim().toUpperCase() === 'V'
    const workMode = String(
      log.workMode || log.workLocation || log.hinhThucLamViec || ''
    ).toLowerCase()

    hasPunch = hasPunch || (!isSyntheticPunch && (hasCheckIn || hasCheckOut))
    missingPunch =
      missingPunch ||
      (!isSyntheticPunch && hasCheckIn !== hasCheckOut) ||
      status === 'KR' ||
      status === 'KV'
    unapprovedAbsence =
      unapprovedAbsence ||
      ['NP', 'VẮNG', 'VANG', 'NGHỈ KHÔNG PHÉP'].includes(status)
    if (isSourcePaidLeave) {
      paidLeaveWorkdays += numberValue(log.congPlus)
    }

    if (workMode.includes('online') || workMode.includes('remote')) {
      onlineWorkdays += logWorkdays
    } else if (
      workMode.includes('offline') ||
      workMode.includes('onsite') ||
      workMode.includes('tại văn phòng')
    ) {
      offlineWorkdays += logWorkdays
    }

    // Khi có Vào/Ra thật, Công phải được tính lại từ số phút; chỉ giữ cong
    // nguồn cho dòng mã công không có cặp punch.
    if (hasNumericValue(log.cong) && (useSourceValues || !hasCheckIn || !hasCheckOut || isSyntheticPunch)) {
      workdays += numberValue(log.cong)
      hasSourceWorkday = true
    }
    if (hasNumericValue(log.congPlus)) {
      extraWorkdays += numberValue(log.congPlus)
      hasSourceWorkday = true
    }
  })

  const standardMinutes = Number(attendanceSettings.standardWorkMinutes) > 0
    ? Number(attendanceSettings.standardWorkMinutes)
    : STANDARD_WORK_MINUTES
  const breakMinutes = Number(attendanceSettings.unpaidBreakMinutes) >= 0
    ? Number(attendanceSettings.unpaidBreakMinutes)
    : 0
  const autoCalculateOvertime = attendanceSettings?.overtime?.autoCalculate !== false
  if (actualPunches.length > 0) {
    const firstPunch = actualPunches
      .slice()
      .sort((left, right) => (attendanceTimeToMinutes(left.checkIn) ?? 0) - (attendanceTimeToMinutes(right.checkIn) ?? 0))[0]
    const lastPunch = actualPunches
      .slice()
      .sort((left, right) => (attendanceTimeToMinutes(right.checkOut) ?? 0) - (attendanceTimeToMinutes(left.checkOut) ?? 0))[0]
    const metrics = calculateAttendanceMetrics({
      log: {
        ...(logs[0] || {}),
        tc1: logs.reduce((sum, log) => sum + numberValue(log.tc1), 0),
        tc2: logs.reduce((sum, log) => sum + numberValue(log.tc2), 0),
        tc3: logs.reduce((sum, log) => sum + numberValue(log.tc3), 0),
        overtimeAutoDisabled: logs.some(log => Boolean(log.overtimeAutoDisabled))
      },
      checkIn: firstPunch.checkIn,
      checkOut: lastPunch.checkOut,
      standardMinutes,
      breakMinutes,
      autoCalculateOvertime,
      punchPairs: logs.flatMap(attendancePunchPairs),
      splitShift: resolvedShift?.splitShift
    })
    hours = metrics.hours
    workdays = metrics.regularWorkdays
    overtimeHours = metrics.overtimeHours
    calculationMode = metrics.calculationMode || 'full-day'
    splitShiftBreakdown = metrics.splitShiftBreakdown || []
  } else if (!hasSourceWorkday) {
    const metrics = calculateAttendanceMetrics({
      log: logs[0] || {},
      standardMinutes,
      breakMinutes,
      autoCalculateOvertime,
      fallbackHours: sourceHours
    })
    hours = metrics.hours
    workdays = metrics.regularWorkdays
    overtimeHours = metrics.overtimeHours
  } else {
    hours = sourceHours
    overtimeHours = logs.reduce((sum, log) => sum +
      numberValue(log.tc1) + numberValue(log.tc2) + numberValue(log.tc3), 0)
  }

  const holiday = getAttendanceHoliday(date, attendanceSettings)
  const hoursExact = Math.max(0, hours)
  const regularWorkdaysExact = Math.max(0, workdays)
  const extraWorkdaysExact = Math.max(0, extraWorkdays)

  return {
    hoursExact,
    workdaysExact: regularWorkdaysExact + extraWorkdaysExact,
    regularWorkdaysExact,
    extraWorkdaysExact,
    workedMinutes: Math.max(0, hoursExact * 60),
    regularMinutes: Math.min(Math.max(0, hoursExact * 60), standardMinutes),
    hours: roundDecimal(hoursExact),
    workdays: roundDecimal(regularWorkdaysExact + extraWorkdaysExact),
    regularWorkdays: roundDecimal(regularWorkdaysExact),
    extraWorkdays: roundDecimal(extraWorkdaysExact),
    overtimeHours: roundDecimal(Math.max(0, overtimeHours)),
    paidLeaveWorkdays: roundDecimal(paidLeaveWorkdays),
    lateMinutes,
    earlyMinutes,
    late: lateMinutes > 0,
    early: earlyMinutes > 0,
    missingPunch,
    unapprovedAbsence,
    onlineWorkdays: Math.round(onlineWorkdays * 100) / 100,
    offlineWorkdays: Math.round(offlineWorkdays * 100) / 100,
    hasPunch,
    checkIn,
    checkOut,
    standardCheckIn,
    standardCheckOut,
    shiftName: shiftName || resolvedShift?.name || '',
    isHoliday: Boolean(holiday),
    holidayName: holiday?.name || '',
    holidayWorkdays: holiday ? roundDecimal(regularWorkdaysExact + extraWorkdaysExact) : 0,
    calculationMode,
    splitShiftBreakdown,
    logs
  }
}

export const buildDailyAttendanceMap = (
  attendanceLogs,
  month = '',
  employees = [],
  attendanceSettings = {}
) => {
  const grouped = new Map()
  const employeesById = new Map(
    employees.map(employee => [String(employee.id), employee])
  )

  attendanceLogs.forEach(log => {
    const date = attendanceDateString(log)
    if (!date || (month && !date.startsWith(month))) return
    const rawEmployeeId = String(log.employeeId || '')
    const employeeId = rawEmployeeId.startsWith('external:')
      ? `external:${buildSourceEmployeeKey(
          log.sourceEmployeeCode || log.employeeCode || '',
          log.sourceEmployeeName || log.employeeName || log.machineName || ''
        )}`
      : rawEmployeeId
    if (!employeeId) return
    const key = `${employeeId}::${date}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(log)
  })

  // Ngày lễ đã cấu hình phải xuất hiện trên ma trận kể cả khi nhân viên
  // không có bản ghi chấm công. Các day summary rỗng này chỉ mang metadata
  // hiển thị, không tự cộng Công/Giờ/Tăng ca.
  const holidayDates = Array.from(new Set(
    (attendanceSettings.holidays || [])
      .map(item => typeof item === 'string' ? item.slice(0, 10) : String(item?.date || item?.day || '').slice(0, 10))
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && (!month || date.startsWith(month)))
  ))
  employees.forEach(employee => {
    const employeeId = String(employee?.id || '')
    if (!employeeId) return
    holidayDates.forEach(date => {
      const key = `${employeeId}::${date}`
      if (!grouped.has(key)) grouped.set(key, [])
    })
  })

  return new Map(
    Array.from(grouped.entries()).map(([key, logs]) => [
      key,
      summarizeAttendanceDay(
        logs,
        employeesById.get(String(logs[0]?.employeeId || key.slice(0, key.lastIndexOf('::')))) || {},
        attendanceSettings,
        key.slice(key.lastIndexOf('::') + 2)
      )
    ])
  )
}

export const buildAttendanceSummary = ({
  attendanceLogs,
  employees,
  month,
  attendanceAdjustments = {},
  manualWorkdays = {},
  attendanceSettings = {}
}) => {
  if (!month) return []

  const employeesById = new Map(
    employees.map(employee => [String(employee.id), employee])
  )
  const dailyMap = buildDailyAttendanceMap(
    attendanceLogs,
    month,
    employees,
    attendanceSettings
  )
  const summaryByEmployee = new Map()

  const ensureSummaryRow = (employeeId, log = {}) => {
    if (summaryByEmployee.has(employeeId)) {
      return summaryByEmployee.get(employeeId)
    }
    const employee = employeesById.get(employeeId)
    const row = {
      employeeId,
      employeeCode:
        employee?.employeeId ||
        employee?.username ||
        log.employeeCode ||
        '',
      employeeName:
        employee?.ho_va_ten ||
        employee?.name ||
        log.employeeName ||
        log.sourceEmployeeName ||
        '',
      department:
        employee?.bo_phan ||
        employee?.department ||
        log.department ||
        '',
      position:
        employee?.vi_tri ||
        employee?.position ||
        log.position ||
        '',
      branch:
        employee?.chi_nhanh ||
        employee?.branch ||
        '',
      shift:
        employee?.ca_lam_viec ||
        employee?.shift ||
        '',
      employmentStatus:
        employee?.trang_thai ||
        employee?.employmentStatus ||
        employee?.status ||
        '',
      contractType:
        employee?.loai_hop_dong ||
        employee?.contractType ||
        '',
      joinDate:
        employee?.ngay_vao_lam ||
        employee?.joinDate ||
        employee?.join_date ||
        '',
      officialDate:
        employee?.ngay_lam_chinh_thuc ||
        employee?.officialDate ||
        employee?.official_date ||
        '',
      lastWorkingDate:
        employee?.ngay_nghi_viec ||
        employee?.lastWorkingDate ||
        employee?.termination_date ||
        '',
      attendanceDays: 0,
      workdays: 0,
      actualWorkdays: 0,
      totalHours: 0,
      overtimeHours: 0,
      lateCount: 0,
      lateUnder30Count: 0,
      lateOver30Count: 0,
      lateMinutes: 0,
      earlyCount: 0,
      earlyUnder30Count: 0,
      earlyOver30Count: 0,
      earlyMinutes: 0,
      missingPunchCount: 0,
      unapprovedAbsenceCount: 0,
      probationWorkdays: 0,
      officialWorkdays: 0,
      paidLeaveWorkdays: 0,
      onlineWorkdays: 0,
      offlineWorkdays: 0,
      days: new Map()
    }
    summaryByEmployee.set(employeeId, row)
    return row
  }

  // Báo cáo nhân sự phải có cả người chưa phát sinh dữ liệu trong tháng.
  employees.forEach(employee => {
    if (employee?.id !== null && employee?.id !== undefined) {
      ensureSummaryRow(String(employee.id))
    }
  })

  dailyMap.forEach((daySummary, key) => {
    const separatorIndex = key.lastIndexOf('::')
    const employeeId = key.slice(0, separatorIndex)
    const date = key.slice(separatorIndex + 2)
    const log = daySummary.logs[0] || {}
    const row = ensureSummaryRow(employeeId, log)
    row.days.set(date, daySummary)
  })

  // Bao phủ cả log của nhân viên ngoài danh sách hồ sơ (nếu có) để holiday
  // vẫn được ghi nhận trong snapshot; nhân viên có hồ sơ đã được xử lý ở
  // buildDailyAttendanceMap.
  const holidayDates = Array.from(new Set(
    (attendanceSettings.holidays || [])
      .map(item => typeof item === 'string' ? item.slice(0, 10) : String(item?.date || item?.day || '').slice(0, 10))
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(month))
  ))
  if (holidayDates.length > 0) {
    summaryByEmployee.forEach(row => {
      const employee = employeesById.get(String(row.employeeId)) || {}
      holidayDates.forEach(date => {
        if (!row.days.has(date)) {
          row.days.set(date, summarizeAttendanceDay([], employee, attendanceSettings, date))
        }
      })
    })
  }

  const adjustedEmployeeIds = new Set([
    ...Object.keys(attendanceAdjustments || {}),
    ...Object.keys(manualWorkdays || {})
  ])
  adjustedEmployeeIds.forEach((employeeId) => {
    if (employeesById.has(String(employeeId))) {
      ensureSummaryRow(String(employeeId))
    }
  })

  summaryByEmployee.forEach(row => {
    const employee = employeesById.get(String(row.employeeId))
    // Ca làm luôn lấy từ Hồ sơ nhân sự khi đã ghép được nhân viên.
    if (employee) {
      row.shift = employee.ca_lam_viec || employee.shift || ''
      if (!row.employeeCode) {
        row.employeeCode = employee.employeeId || employee.username || row.employeeCode
      }
      if (!row.employeeName) {
        row.employeeName = employee.ho_va_ten || employee.name || row.employeeName
      }
      if (!row.department) {
        row.department = employee.bo_phan || employee.department || row.department
      }
    }

    const permissionDays = String(attendanceAdjustments[row.employeeId] || '')
      .split(',')
      .map(value => Number.parseInt(value.trim(), 10))
      .filter(Number.isFinite)

    permissionDays.forEach(day => {
      const date = `${month}-${String(day).padStart(2, '0')}`
      const current = row.days.get(date) || summarizeAttendanceDay(
        [],
        employee || {},
        attendanceSettings,
        date
      )
      const paidLeaveWorkdays = numberValue(
        manualWorkdays[row.employeeId]?.[day] ??
        manualWorkdays[row.employeeId]?.[String(day)] ??
        1
      )
      row.days.set(date, {
        ...current,
        workdays: paidLeaveWorkdays,
        workdaysExact: paidLeaveWorkdays,
        regularWorkdays: paidLeaveWorkdays,
        regularWorkdaysExact: paidLeaveWorkdays,
        extraWorkdays: 0,
        extraWorkdaysExact: 0,
        paidLeaveWorkdays,
        unapprovedAbsence: false
      })
    })

    // Override công từng ngày do Kế toán/HR chỉnh tay (không chỉ ngày phép).
    const overrides = manualWorkdays[row.employeeId] || manualWorkdays[String(row.employeeId)] || {}
    Object.entries(overrides).forEach(([dayKey, rawValue]) => {
      const day = Number(dayKey)
      if (!Number.isFinite(day) || day < 1 || day > 31) return
      const date = `${month}-${String(day).padStart(2, '0')}`
      const current = row.days.get(date) || summarizeAttendanceDay(
        [],
        employee || {},
        attendanceSettings,
        date
      )
      const workdays = numberValue(rawValue)
      const isPaidLeaveDay = permissionDays.includes(day)
      row.days.set(date, {
        ...current,
        workdays,
        workdaysExact: workdays,
        regularWorkdays: workdays,
        regularWorkdaysExact: workdays,
        extraWorkdays: 0,
        extraWorkdaysExact: 0,
        paidLeaveWorkdays: isPaidLeaveDay ? workdays : 0,
        manualOverride: true,
        unapprovedAbsence: false
      })
    })

    row.days.forEach((day, date) => {
      const paidLeaveWorkdays = numberValue(day.paidLeaveWorkdays)
      const dayWorkdays = numberValue(day.workdaysExact ?? day.workdays)
      const actualWorkdays = Math.max(0, dayWorkdays - paidLeaveWorkdays)
      const officialDate = String(row.officialDate || '').slice(0, 10)
      const isProbation = officialDate
        ? date < officialDate
        : String(row.employmentStatus || '').toLowerCase().includes('thử việc')
      const explicitOnline = Math.min(actualWorkdays, numberValue(day.onlineWorkdays))
      const explicitOffline = Math.min(
        Math.max(0, actualWorkdays - explicitOnline),
        numberValue(day.offlineWorkdays)
      )

      row.workdays += day.workdaysExact ?? day.workdays
      row.actualWorkdays += actualWorkdays
      row.totalHours += day.hoursExact ?? day.hours
      row.overtimeHours += day.overtimeHours
      row.attendanceDays += day.hasPunch || dayWorkdays > 0 ? 1 : 0
      row.lateCount += day.late ? 1 : 0
      row.lateUnder30Count += day.late && day.lateMinutes < 30 ? 1 : 0
      row.lateOver30Count += day.late && day.lateMinutes >= 30 ? 1 : 0
      row.lateMinutes += day.lateMinutes
      row.earlyCount += day.early ? 1 : 0
      row.earlyUnder30Count += day.early && day.earlyMinutes < 30 ? 1 : 0
      row.earlyOver30Count += day.early && day.earlyMinutes >= 30 ? 1 : 0
      row.earlyMinutes += day.earlyMinutes
      row.missingPunchCount += day.missingPunch ? 1 : 0
      row.unapprovedAbsenceCount += day.unapprovedAbsence ? 1 : 0
      row.paidLeaveWorkdays += paidLeaveWorkdays
      row.probationWorkdays += isProbation ? actualWorkdays : 0
      row.officialWorkdays += isProbation ? 0 : actualWorkdays
      row.onlineWorkdays += explicitOnline
      row.offlineWorkdays +=
        explicitOffline + Math.max(0, actualWorkdays - explicitOnline - explicitOffline)
    })

    row.workdays = Math.round(row.workdays * 100) / 100
    row.actualWorkdays = Math.round(row.actualWorkdays * 100) / 100
    row.totalHours = Math.round(row.totalHours * 100) / 100
    row.overtimeHours = Math.round(row.overtimeHours * 100) / 100
    row.probationWorkdays = Math.round(row.probationWorkdays * 100) / 100
    row.officialWorkdays = Math.round(row.officialWorkdays * 100) / 100
    row.paidLeaveWorkdays = Math.round(row.paidLeaveWorkdays * 100) / 100
    row.onlineWorkdays = Math.round(row.onlineWorkdays * 100) / 100
    row.offlineWorkdays = Math.round(row.offlineWorkdays * 100) / 100
  })

  return Array.from(summaryByEmployee.values()).sort((left, right) =>
    left.employeeName.localeCompare(right.employeeName, 'vi')
  )
}

const slimDayLogs = (logs = []) =>
  logs.map(log => ({
    kyHieu: log.kyHieu || '',
    kyHieuPlus: log.kyHieuPlus || '',
    status: log.status || '',
    checkIn: log.checkIn || log.vao || '',
    checkOut: log.checkOut || log.ra || '',
    vao: log.vao || log.checkIn || '',
    ra: log.ra || log.checkOut || '',
    shiftName: log.shiftName || log.tenCa || '',
    tenCa: log.tenCa || log.shiftName || '',
    punches: Array.isArray(log.punches) ? log.punches : [],
    punchPairs: Array.isArray(log.punchPairs) ? log.punchPairs : []
  }))
/** Persist summary rows to hr_records (Map → plain object, slim logs). */
export const serializeAttendanceSummaryRows = (rows = []) =>
  rows.map(row => ({
    ...row,
    days: Object.fromEntries(
      Array.from(row.days?.entries?.() || []).map(([date, day]) => [
        date,
        {
          hoursExact: day.hoursExact ?? day.hours,
          workdaysExact: day.workdaysExact ?? day.workdays,
          regularWorkdaysExact: day.regularWorkdaysExact ?? day.regularWorkdays,
          extraWorkdaysExact: day.extraWorkdaysExact ?? day.extraWorkdays,
          workedMinutes: day.workedMinutes,
          regularMinutes: day.regularMinutes,
          hours: day.hours,
          workdays: day.workdays,
          regularWorkdays: day.regularWorkdays,
          extraWorkdays: day.extraWorkdays,
          overtimeHours: day.overtimeHours,
          paidLeaveWorkdays: day.paidLeaveWorkdays,
          lateMinutes: day.lateMinutes,
          earlyMinutes: day.earlyMinutes,
          late: Boolean(day.late),
          early: Boolean(day.early),
          missingPunch: Boolean(day.missingPunch),
          unapprovedAbsence: Boolean(day.unapprovedAbsence),
          onlineWorkdays: day.onlineWorkdays,
          offlineWorkdays: day.offlineWorkdays,
          hasPunch: Boolean(day.hasPunch),
          checkIn: day.checkIn || '',
          checkOut: day.checkOut || '',
          standardCheckIn: day.standardCheckIn || '',
          standardCheckOut: day.standardCheckOut || '',
          shiftName: day.shiftName || '',
          isHoliday: Boolean(day.isHoliday),
          holidayName: day.holidayName || '',
          holidayWorkdays: day.holidayWorkdays || 0,
          manualOverride: Boolean(day.manualOverride),
          calculationMode: day.calculationMode || 'full-day',
          splitShiftBreakdown: day.splitShiftBreakdown || [],
          logs: slimDayLogs(day.logs)
        }
      ])
    )
  }))
/** Restore summary rows after loading from snapshot (plain object → Map). */
export const hydrateAttendanceSummaryRows = (rows = []) =>
  (rows || []).map(row => ({
    ...row,
    days: new Map(Object.entries(row.days || {}))
  }))
