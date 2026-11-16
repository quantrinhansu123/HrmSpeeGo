import { parseFlexibleDate } from './helpers.js'

export const LEAVE_MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1))

export const isLeaveYear = value => /^\d{4}$/.test(String(value)) && Number(value) >= 1900 && Number(value) <= 9999

export const parseLeaveAmount = value => {
  if (value === '' || value === null || value === undefined) return null
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value
  if (typeof normalized === 'string' && !/^\d+(\.\d+)?$/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

// Clamp calendar months exactly as PostgreSQL date + interval '6 months'.
export const leaveEligibilityDate = employee => {
  const iso = parseFlexibleDate(employee?.ngay_lam_chinh_thuc || employee?.official_date)
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  const end = new Date(Date.UTC(year, month - 1 + 7, 0))
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(day, end.getUTCDate()))).toISOString().slice(0, 10)
}

export const formatLeaveAmount = value => Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })

export const validateMonthlyLeaveInput = (months, note) => {
  if (!note || note.trim().length < 5) return 'Nhập lý do điều chỉnh ít nhất 5 ký tự.'
  for (const [month, amount] of Object.entries(months || {})) {
    if (!LEAVE_MONTHS.includes(month) || (amount !== '' && parseLeaveAmount(amount) === null)) {
      return `Số phép tháng ${month} không hợp lệ. Nhập số từ 0 trở lên.`
    }
  }
  return ''
}

export const normalizeLeaveData = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([year, entry]) => isLeaveYear(year) && entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(([year, entry]) => {
      const months = entry.months && typeof entry.months === 'object' && !Array.isArray(entry.months)
        ? Object.fromEntries(Object.entries(entry.months)
          .filter(([month, amount]) => LEAVE_MONTHS.includes(month) && parseLeaveAmount(amount) !== null)
          .map(([month, amount]) => [month, parseLeaveAmount(amount)]))
        : {}
      return [year, { total_leave: parseLeaveAmount(entry.total_leave) ?? 0, months }]
    }))
}

export const formatTenure = (joinDate, today = new Date()) => {
  const iso = parseFlexibleDate(joinDate)
  if (!iso) return 'Chưa có ngày vào làm'
  const [year, month, day] = iso.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  if (Number.isNaN(start.getTime()) || start > today) return 'Chưa đến ngày vào làm'

  const completedMonths = (today.getFullYear() - year) * 12 + today.getMonth() + 1 - month - (today.getDate() < day ? 1 : 0)
  if (completedMonths < 1) return 'Dưới 1 tháng'
  const years = Math.floor(completedMonths / 12)
  const months = completedMonths % 12
  return years ? `${years} năm ${months} tháng` : `${months} tháng`
}
