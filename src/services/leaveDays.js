import { supabase } from './supabase'
import { isValidLeaveDate, normalizeLeaveReason, validateLeaveAdjustment } from '../utils/leaveDays'

const TABLE = 'employee_leave_days'
const PAGE_SIZE = 1000
const SUMMARY_COLUMNS = 'id, employee_id, employee_name, leave_date, reason, status, approval_request_id, approval_snapshot, original_leave_date, adjustment_count, updated_at'

const throwLeaveError = error => {
  if (!error) return
  if (error.code === '23505') throw new Error('Nhân sự đã có ngày nghỉ vào ngày được chọn.')
  if (['42703', 'PGRST204', 'PGRST202'].includes(error.code)) {
    throw new Error('Cần cập nhật cơ sở dữ liệu ngày nghỉ phép (migration 20261116100000_leave_day_links_and_adjustments.sql).')
  }
  if (error.code === 'PGRST205' || error.code === '42P01') {
    throw new Error('Chức năng ngày nghỉ phép chưa được thiết lập trên hệ thống.')
  }
  throw error
}

export const loadLeaveDays = async ({ companyId, employeeId, approvalRequestId }) => {
  if (!companyId) throw new Error('Thiếu mã công ty.')
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(TABLE)
      .select(SUMMARY_COLUMNS)
      .eq('company_id', companyId)
    if (employeeId) query = query.eq('employee_id', employeeId)
    if (approvalRequestId) query = query.eq('approval_request_id', `approvalRequests::${String(approvalRequestId).replace(/^approvalRequests::/, '')}`)
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

export const approveLeaveDay = async ({ companyId, leaveDayId }) => {
  if (!companyId || !leaveDayId) throw new Error('Thiếu thông tin ngày nghỉ phép.')
  const { data, error } = await supabase.from(TABLE)
    .update({ status: 'approved' })
    .eq('id', leaveDayId)
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .select(SUMMARY_COLUMNS)
    .single()
  throwLeaveError(error)
  return data
}

const deleteLeaveDaysDirect = async leaveIds => {
  const removed = []
  for (let index = 0; index < leaveIds.length; index += 100) {
    const chunk = leaveIds.slice(index, index + 100)
    const { data, error } = await supabase.from(TABLE)
      .delete()
      .in('id', chunk)
      .select('id')
    throwLeaveError(error)
    removed.push(...(data || []).map(row => row.id))
  }
  return removed
}

export const deleteLeaveDays = async ({ ids }) => {
  const leaveIds = [...new Set((ids || []).filter(Boolean))]
  if (leaveIds.length === 0) throw new Error('Chưa chọn ngày nghỉ phép để xóa.')

  const rpc = await supabase.rpc('delete_employee_leave_days', { p_ids: leaveIds })
  const missingFunction = /delete_employee_leave_days|schema cache|could not find the function/i.test(rpc.error?.message || '')
  let removed = []
  if (!rpc.error) {
    removed = Array.isArray(rpc.data) ? rpc.data : []
  } else if (!missingFunction) {
    throwLeaveError(rpc.error)
  } else {
    removed = await deleteLeaveDaysDirect(leaveIds)
  }

  if (removed.length < leaveIds.length) {
    throw new Error('Chưa xóa hết ngày nghỉ phép đã chọn. Hãy chạy file supabase/migrations/20261004120000_delete_leave_days_all.sql trong SQL Editor.')
  }
  return removed
}

export const addLeaveDay = async ({ companyId, employeeId, leaveDate, reason }) => {
  if (!companyId || !employeeId) throw new Error('Thiếu thông tin tài khoản nhân sự.')
  if (!isValidLeaveDate(leaveDate)) throw new Error('Vui lòng chọn ngày nghỉ hợp lệ.')
  const normalizedReason = normalizeLeaveReason(reason)
  const { data, error } = await supabase.from(TABLE)
    .insert({ company_id: companyId, employee_id: employeeId, leave_date: leaveDate, reason: normalizedReason })
    .select(SUMMARY_COLUMNS)
    .single()
  throwLeaveError(error)
  return data
}

export const loadLeaveDayDetails = async ({ companyId, id }) => {
  if (!companyId || !id) throw new Error('Thiếu thông tin ngày nghỉ phép.')
  const { data, error } = await supabase.from(TABLE)
    .select(`${SUMMARY_COLUMNS}, adjustment_history`)
    .eq('company_id', companyId).eq('id', id).single()
  throwLeaveError(error)
  let approval = null
  if (data.approval_request_id) {
    const result = await supabase.from('hr_records').select('id, data')
      .eq('collection', 'approvalRequests').eq('id', data.approval_request_id).maybeSingle()
    throwLeaveError(result.error)
    const request = result.data?.data
    if (request && request.requesterId === data.employee_id
      && (request.companyId || 'speego-original') === companyId) {
      approval = { ...request, id: data.approval_snapshot?.id || data.approval_request_id.replace(/^approvalRequests::/, '') }
    }
  }
  return { ...data, approval }
}

export const adjustLeaveDay = async ({ id, leaveDate, reason, note, attachments, expectedUpdatedAt }) => {
  const normalized = validateLeaveAdjustment({ leaveDate, reason, note, attachments })
  if (!id || !expectedUpdatedAt) throw new Error('Hãy tải lại ngày nghỉ trước khi điều chỉnh.')
  const { data, error } = await supabase.rpc('adjust_employee_leave_day', {
    p_id: id, p_leave_date: normalized.leaveDate, p_reason: normalized.reason,
    p_note: normalized.note, p_attachments: normalized.attachments,
    p_expected_updated_at: expectedUpdatedAt
  })
  throwLeaveError(error)
  return data
}
