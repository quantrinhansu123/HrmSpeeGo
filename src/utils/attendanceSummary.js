import { buildSourceEmployeeKey } from './attendanceMatching.js'
import {
  applyCalculatedAttendanceTiming,
  formatAttendanceTime,
  resolveAttendanceShift
} from './attendanceShift.js'

const numberValue = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

export const summarizeAttendanceDay = (logs, employee = {}, attendanceSettings = {}) => {
  let hours = 0
  let workdays = 0
  let extraWorkdays = 0
  let overtimeHours = 0
  let paidLeaveWorkdays = 0
  let lateMinutes = 0
  let earlyMinutes = 0
  let onlineWorkdays = 0
  let offlineWorkdays = 0
  let hasSourceWorkday = false
  let hasPunch = false
  let missingPunch = false
  let unapprovedAbsence = false
  let checkIn = ''
  let checkOut = ''
  let shiftName = ''
  const sampleLog = logs[0] || {}
  const resolvedShift = resolveAttendanceShift(employee, sampleLog, attendanceSettings)
  const standardCheckIn = formatAttendanceTime(resolvedShift?.start || resolvedShift?.standardCheckIn)
  const standardCheckOut = formatAttendanceTime(resolvedShift?.end || resolvedShift?.standardCheckOut)

  logs.forEach(sourceLog => {
    const log = applyCalculatedAttendanceTiming(sourceLog, employee, attendanceSettings)
    const logHours = numberValue(log.tongGio ?? (
      numberValue(log.hours ?? log.soGio ?? log.gio) +
      numberValue(log.gioPlus)
    ))
    hours += logHours
    overtimeHours +=
      numberValue(log.tc1) +
      numberValue(log.tc2) +
      numberValue(log.tc3)
    lateMinutes += numberValue(log.lateMinutes ?? log.vaoTre)
    earlyMinutes += numberValue(log.earlyMinutes ?? log.raSom)
    const logCheckIn = formatAttendanceTime(log.checkIn || log.vao)
    const logCheckOut = formatAttendanceTime(log.checkOut || log.ra)
    const hasCheckIn = Boolean(logCheckIn)
    const hasCheckOut = Boolean(logCheckOut)
    if (hasCheckIn && (!checkIn || logCheckIn < checkIn)) checkIn = logCheckIn
    if (hasCheckOut && (!checkOut || logCheckOut > checkOut)) checkOut = logCheckOut
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

    hasPunch = hasPunch || hasCheckIn || hasCheckOut
    missingPunch =
      missingPunch ||
      hasCheckIn !== hasCheckOut ||
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

    if (hasNumericValue(log.cong)) {
      workdays += numberValue(log.cong)
      hasSourceWorkday = true
    }
    if (hasNumericValue(log.congPlus)) {
      extraWorkdays += numberValue(log.congPlus)
      hasSourceWorkday = true
    }
  })

  if (!hasSourceWorkday) {
    workdays = hours >= 7.5 ? 1 : hours >= 3 ? 0.5 : 0
  }

  return {
    hours: Math.round(hours * 100) / 100,
    workdays: Math.round((workdays + extraWorkdays) * 100) / 100,
    regularWorkdays: Math.round(workdays * 100) / 100,
    extraWorkdays: Math.round(extraWorkdays * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    paidLeaveWorkdays: Math.round(paidLeaveWorkdays * 100) / 100,
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

  return new Map(
    Array.from(grouped.entries()).map(([key, logs]) => [
      key,
      summarizeAttendanceDay(
        logs,
        employeesById.get(String(logs[0]?.employeeId || '')) || {},
        attendanceSettings
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
      const current = row.days.get(date) || summarizeAttendanceDay([])
      const paidLeaveWorkdays = numberValue(
        manualWorkdays[row.employeeId]?.[day] ?? 1
      )
      row.days.set(date, {
        ...current,
        workdays: paidLeaveWorkdays,
        paidLeaveWorkdays,
        unapprovedAbsence: false
      })
    })

    row.days.forEach((day, date) => {
      const paidLeaveWorkdays = numberValue(day.paidLeaveWorkdays)
      const actualWorkdays = Math.max(0, day.workdays - paidLeaveWorkdays)
      const officialDate = String(row.officialDate || '').slice(0, 10)
      const isProbation = officialDate
        ? date < officialDate
        : String(row.employmentStatus || '').toLowerCase().includes('thử việc')
      const explicitOnline = Math.min(actualWorkdays, numberValue(day.onlineWorkdays))
      const explicitOffline = Math.min(
        Math.max(0, actualWorkdays - explicitOnline),
        numberValue(day.offlineWorkdays)
      )

      row.workdays += day.workdays
      row.totalHours += day.hours
      row.overtimeHours += day.overtimeHours
      row.attendanceDays += day.hasPunch || day.workdays > 0 ? 1 : 0
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
    tenCa: log.tenCa || log.shiftName || ''
  }))

/** Persist summary rows to hr_records (Map → plain object, slim logs). */
export const serializeAttendanceSummaryRows = (rows = []) =>
  rows.map(row => ({
    ...row,
    days: Object.fromEntries(
      Array.from(row.days?.entries?.() || []).map(([date, day]) => [
        date,
        {
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
