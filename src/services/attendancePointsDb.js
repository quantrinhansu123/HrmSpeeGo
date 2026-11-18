import { supabase } from './supabase'
import { ATTENDANCE_BENEFIT_GROUPS, isAttendancePointsMonth, normalizePointEvent, validatePointEvents } from '../utils/attendancePoints'

const fromDb = row => normalizePointEvent({
  id: row.id, month: row.month, date: row.penalty_date,
  employeeId: row.employee_id, employeeCode: row.employee_code, employeeName: row.employee_name,
  eventType: row.event_type, categoryKey: row.category_key, points: row.points, minutes: row.minutes,
  content: row.content, note: row.note, source: row.source,
  reviewStatus: row.review_status, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at
})

const check = result => {
  if (result.error) {
    if (/schema cache|could not find.*function|does not exist/i.test(result.error.message || '')) {
      throw new Error('Chưa thiết lập bảng điểm chuyên cần. Cần áp dụng migration 20261118100000_attendance_points.sql.')
    }
    throw result.error
  }
  return result.data
}

export const loadAttendancePointMonth = async month => {
  if (!isAttendancePointsMonth(month)) throw new Error('Quy chế điểm áp dụng từ tháng 11/2026.')
  const monthState = check(await supabase.rpc('load_attendance_point_month', { p_month: month }))
  return {
    rows: (monthState?.rows || []).map(fromDb),
    benefits: monthState?.benefits || {},
    version: monthState?.version || 0,
    generatedAt: monthState?.generatedAt || ''
  }
}

export const saveAttendancePointMonth = async (month, rows, benefits, version) => {
  validatePointEvents(month, rows)
  if (Object.values(benefits).some(value => !ATTENDANCE_BENEFIT_GROUPS.some(group => group.key === value))) throw new Error('Nhóm phúc lợi không hợp lệ.')
  const result = await supabase.rpc('save_attendance_points', {
    p_month: month, p_rows: rows.map(normalizePointEvent), p_benefits: benefits, p_expected_version: version
  })
  const saved = check(result)
  // Trả đúng phiên vừa ghi; không GET lại để vô tình nhận một phiên mới hơn.
  return { rows: (saved.rows || []).map(fromDb), benefits: saved.benefits, version: saved.version, generatedAt: saved.generatedAt }
}

export const loadMyAttendancePointEvents = async (employeeId, month) => {
  if (!isAttendancePointsMonth(month)) return []
  const result = await supabase.from('attendance_point_events').select('*')
    .eq('employee_id', employeeId).eq('month', month).in('review_status', ['confirmed', 'exempt']).order('penalty_date')
  return (check(result) || []).map(fromDb)
}
