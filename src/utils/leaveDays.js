import { validateAttachmentFiles } from './attachments.js'

export const todayLocalDate = (today = new Date()) => {
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const isValidLeaveDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day
}

export const formatLeaveDate = value =>
  isValidLeaveDate(value) ? value.split('-').reverse().join('/') : '—'

export const LEAVE_REASON_OPTIONS = Object.freeze(['Nghỉ cố định', 'Nghỉ có phép'])
export const LEAVE_REASON_FROM_APPROVAL = 'Nghỉ có phép'

export const normalizeLeaveReason = value => {
  const reason = String(value || '').trim()
  if (!LEAVE_REASON_OPTIONS.includes(reason)) throw new Error('Vui lòng chọn lý do nghỉ phép.')
  return reason
}
export const validateLeaveAdjustment = ({ leaveDate, reason, note, attachments = [] }) => {
  if (!isValidLeaveDate(leaveDate)) throw new Error('Vui lòng chọn ngày nghỉ hợp lệ.')
  const normalizedNote = String(note || '').trim()
  if (normalizedNote.length < 5 || normalizedNote.length > 2000) {
    throw new Error('Ghi chú điều chỉnh cần từ 5 đến 2.000 ký tự.')
  }
  if (!Array.isArray(attachments)) throw new Error('Danh sách tệp không hợp lệ.')
  validateAttachmentFiles(attachments)
  return { leaveDate, reason: normalizeLeaveReason(reason), note: normalizedNote, attachments }
}
