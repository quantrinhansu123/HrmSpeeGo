import { supabase } from './supabase'
import { isValidLeaveDate, normalizeLeaveReason } from '../utils/leaveDays'

const TABLE = 'employee_leave_days'
const PAGE_SIZE = 1000

const throwLeaveError = error => {
  if (!error) return
  if (error.code === '23505') throw new Error('Ngày nghỉ này đã được ghi nhận cho bạn.')
  if (error.code === 'PGRST205' || error.code === '42P01') {
    throw new Error('Chức năng ngày nghỉ phép chưa được thiết lập trên hệ thống.')
  }
  throw error
}

export const loadLeaveDays = async ({ companyId, employeeId }) => {
  if (!companyId) throw new Error('Thiếu mã công ty.')
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(TABLE)
      .select('id, employee_id, employee_name, leave_date, reason')
      .eq('company_id', companyId)
    if (employeeId) query = query.eq('employee_id', employeeId)
    const { data, error } = await query
      .order('leave_date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    throwLeaveError(error)
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

export const addLeaveDay = async ({ companyId, employeeId, leaveDate, reason }) => {
  if (!companyId || !employeeId) throw new Error('Thiếu thông tin tài khoản nhân sự.')
  if (!isValidLeaveDate(leaveDate)) throw new Error('Vui lòng chọn ngày nghỉ hợp lệ.')
  const normalizedReason = normalizeLeaveReason(reason)
  const { data, error } = await supabase.from(TABLE)
    .insert({ company_id: companyId, employee_id: employeeId, leave_date: leaveDate, reason: normalizedReason })
    .select('id, employee_id, employee_name, leave_date, reason')
    .single()
  throwLeaveError(error)
  return data
}
