import { attendanceDateString, attendancePunchPairs, buildDailyAttendanceMap, summarizeAttendanceDay } from './attendanceSummary.js'
import { roundDecimal } from './attendanceCalculations.js'
import { LATE_EARLY_WORKDAY_THRESHOLD } from './attendanceLateEarly.js'

// Imported Công/Giờ can predate the current attendance rules. Use the same
// calculation as the monthly summary when displaying or exporting a punch log.
export const calculateAttendanceDetailLog = (log, employee = {}, attendanceSettings = {}, options = {}) => {
  if (['source-value', 'matrix-value'].includes(log.calculationMode) ||
      !attendancePunchPairs(log).length) return log

  const day = summarizeAttendanceDay([log], employee, attendanceSettings, attendanceDateString(log), false, options)
  return {
    ...log,
    cong: day.regularWorkdays,
    hours: day.hours,
    tongGio: roundDecimal(day.hoursExact + (Number(log.gioPlus) || 0)),
    lateMinutes: day.lateMinutes,
    earlyMinutes: day.earlyMinutes
  }
}

export const calculateAttendanceDetailLogs = (logs, employeesById = new Map(), attendanceSettings = {}) => {
  const dayByLog = new Map()
  const days = buildDailyAttendanceMap(logs, '', [...employeesById.values()], attendanceSettings)
  days.forEach(day => day.logs.forEach(log => dayByLog.set(log, day)))
  return logs.map(log => {
    const day = dayByLog.get(log)
    const total = day ? day.lateMinutes + day.earlyMinutes : null
    // Use the whole day's threshold even when its punches occupy several rows.
    const options = total === null ? {} : {
      forgiveLateEarly: total > 0 && total < LATE_EARLY_WORKDAY_THRESHOLD
    }
    return calculateAttendanceDetailLog(log, employeesById.get(String(log.employeeId)) || {}, attendanceSettings, options)
  })
}
