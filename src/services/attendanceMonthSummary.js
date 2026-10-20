import {
  fbGet,
  fbGetAttendanceLogsByMonth,
  fbGetEmployeesDirectory,
  fbSet
} from './firebase'
import {
  buildAttendanceSummary,
  serializeAttendanceSummaryRows
} from '../utils/attendanceSummary'
import { normalizeAttendanceShiftSettings } from '../utils/attendanceShift'
import { getCompanyIdForUser, getCompanyNameForContext } from '../utils/companyContext'

/**
 * Rebuild and persist the monthly attendance snapshot used by /bang-cong-preview.
 * Online check-in/out writes attendanceLogs only; this syncs those logs into
 * attendanceMonthSummaries so the bảng công table stays up to date.
 */
export const rebuildAttendanceMonthSummary = async (
  targetMonth,
  {
    companyId = getCompanyIdForUser(),
    companyName = getCompanyNameForContext({ name: 'SpeeGo Logistics' })
  } = {}
) => {
  const period = String(targetMonth || '').trim()
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('Tháng không hợp lệ. Dùng định dạng YYYY-MM.')
  }

  const [employeeData, logData, nextAdjustments, nextManuals, storedSettings] = await Promise.all([
    fbGetEmployeesDirectory(companyId),
    fbGetAttendanceLogsByMonth(period, companyId),
    fbGet(`hr/attendanceAdjustments/${period}`, companyId),
    fbGet(`hr/manualWorkdays/${period}`, companyId),
    fbGet('hr/attendanceSettings/default', companyId)
  ])

  const attendanceSettings = normalizeAttendanceShiftSettings(storedSettings)
  const employeeList = employeeData
    ? Object.entries(employeeData).map(([id, value]) => ({ ...value, id }))
    : []
  const monthLogs = logData
    ? Object.entries(logData).map(([id, value]) => ({ ...value, id }))
    : []
  const summaryRows = buildAttendanceSummary({
    attendanceLogs: monthLogs,
    employees: employeeList,
    month: period,
    attendanceAdjustments: nextAdjustments || {},
    manualWorkdays: nextManuals || {},
    attendanceSettings
  })
  const validEmpIds = new Set(employeeList.map(employee => String(employee.id)))
  const filteredSummaryRows = summaryRows.filter(row => validEmpIds.has(String(row.employeeId)))
  const snapshot = {
    month: period,
    companyId,
    companyName,
    generatedAt: new Date().toISOString(),
    sourceLogCount: monthLogs.length,
    employeeCount: filteredSummaryRows.length,
    rows: serializeAttendanceSummaryRows(filteredSummaryRows)
  }

  await fbSet(`hr/attendanceMonthSummaries/${period}`, snapshot, companyId)
  return snapshot
}

export const rebuildAttendanceMonthSummaryForDate = async (dateValue, options = {}) => {
  const period = String(dateValue || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(period)) return null
  return rebuildAttendanceMonthSummary(period, options)
}
