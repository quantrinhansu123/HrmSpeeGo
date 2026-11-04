import { supabase } from './supabase'

const migrationHint = 'Chưa bật luồng điều chỉnh công. Hãy chạy migration supabase/migrations/20261104100000_attendance_punch_corrections.sql trong SQL Editor.'

const throwCorrectionError = error => {
  if (!error) return
  const message = String(error.message || '')
  if (/attendance_correction|schema cache|could not find the function/i.test(message)) {
    throw new Error(migrationHint)
  }
  throw error
}

export const loadAttendanceCorrectionRequests = async () => {
  const { data, error } = await supabase.rpc('list_attendance_correction_requests')
  throwCorrectionError(error)
  return Array.isArray(data) ? data : []
}

export const submitAttendanceCorrection = async ({
  date,
  attendanceLogId,
  checkIn,
  checkOut,
  reason
}) => {
  const { data, error } = await supabase.rpc('submit_attendance_correction', {
    p_date: date,
    p_log_id: attendanceLogId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_reason: reason
  })
  throwCorrectionError(error)
  return data
}

export const decideAttendanceCorrection = async ({ id, decision, comment = '' }) => {
  const { data, error } = await supabase.rpc('decide_attendance_correction', {
    p_id: id,
    p_decision: decision,
    p_comment: comment
  })
  throwCorrectionError(error)
  return data
}
