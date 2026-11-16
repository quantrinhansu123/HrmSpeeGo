import { supabase } from './supabase'
import { loadEmployeeDirectory } from './employeeDirectory'
import { mapUserToApp } from '../utils/helpers'

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (['PGRST202', 'PGRST205', '42P01'].includes(error.code)) {
      throw new Error('Cần cập nhật cơ sở dữ liệu phép theo tháng (migration 20261117100000_monthly_leave_accrual.sql).')
    }
    throw error
  }
  return data
}

export const loadLeaveEmployees = async companyId => {
  if (!companyId) throw new Error('Thiếu mã công ty.')
  const { rows } = await loadEmployeeDirectory({
    columns: 'id, employee_id, name, join_date, official_date, status, employment_status, role, company_id, department'
  })
  return rows.filter(row => (row.company_id || 'speego-original') === companyId)
    .map(mapUserToApp).sort((a, b) => a.ho_va_ten.localeCompare(b.ho_va_ten, 'vi'))
}

// Company and employee identity are resolved by the database.
export const loadLeaveBoard = year => rpc('company_monthly_leave_board', { p_year: Number(year) })
// Compatibility with the payroll table, using the same monthly source of truth.
export const loadEmployeeLeaveSettings = async (companyId, year = new Date().getFullYear()) => {
  if (!companyId) throw new Error('Thiếu mã công ty.')
  const board = await loadLeaveBoard(year)
  return Object.fromEntries(Object.entries(board || {}).filter(([, data]) => data.configured)
    .map(([id, data]) => [id, { [year]: { total_leave: data.total, remaining: data.remaining, used: data.used, reserved: data.reserved,
      months: Object.fromEntries(Object.entries(data.months || {}).map(([month, period]) => [month, period.amount])) } }]))
}
export const configureLeaveYear = ({ employeeId, year, opening, throughMonth, note }) =>
  rpc('configure_monthly_leave_year', { p_employee_id: employeeId, p_year: Number(year),
    p_opening: Number(String(opening).replace(',', '.')), p_through_month: Number(throughMonth), p_note: note })

export const saveMonthlyLeave = ({ employeeId, year, months, expectedVersion, note }) =>
  rpc('save_monthly_leave', { p_employee_id: employeeId, p_year: Number(year),
    p_months: Object.fromEntries(Object.entries(months).map(([key, value]) => [key,
      value === '' ? null : Number(String(value).replace(',', '.'))])),
    p_expected_version: expectedVersion, p_note: note })

export const recalculateLeave = () => rpc('recalculate_company_leave', {})
export const confirmLeaveContinuation = ({ employeeId, decision, note }) =>
  rpc('confirm_leave_continuation', { p_employee_id: employeeId, p_decision: decision, p_note: note })
export const adjustLeaveBalance = ({ employeeId, year, amount, kind, sourceYear, note }) =>
  rpc('adjust_monthly_leave_balance', { p_employee_id: employeeId, p_year: Number(year),
    p_amount: Number(String(amount).replace(',', '.')), p_kind: kind,
    p_source_year: sourceYear ? Number(sourceYear) : null, p_note: note })

export const previewLeaveRequest = request => rpc('preview_monthly_leave_request', { p_data: request })
