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

export const normalizeLeaveReason = value => {
  const reason = String(value || '').trim()
  if (!reason) throw new Error('Vui lòng nhập lý do nghỉ phép.')
  if (reason.length > 500) throw new Error('Lý do nghỉ phép không được quá 500 ký tự.')
  return reason
}
