export const PENALTY_CATEGORIES = [
  { label: 'Muộn/sớm <30p', amount: 50000 },
  { label: 'Muộn/sớm ≥30p', amount: 100000 },
  { label: 'Quên chấm', amount: 50000 },
  { label: 'Không trực nhật', amount: 50000 },
  { label: 'Nghỉ đột xuất', amount: 100000 },
  { label: 'Nghỉ không phép', amount: 200000 },
  { label: 'Say xỉn', amount: 200000 },
  { label: 'Khác', amount: 0 }
]

export const createEmptyPenaltyRow = (monthValue = '') => ({
  id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  date: monthValue ? `${monthValue}-01` : '',
  employeeId: '',
  employeeCode: '',
  employeeName: '',
  category: PENALTY_CATEGORIES[0].label,
  content: '',
  amount: PENALTY_CATEGORIES[0].amount,
  note: '',
  source: 'manual'
})

export const normalizePenaltyRows = (rows = []) =>
  (rows || []).map((row, index) => ({
    id: row.id || `p-legacy-${index}-${String(row.date || '')}-${String(row.employeeId || row.employeeName || '')}`,
    date: String(row.date || '').slice(0, 10),
    employeeId: row.employeeId || '',
    employeeCode: row.employeeCode || '',
    employeeName: row.employeeName || '',
    category: row.category || '',
    content: row.content || '',
    amount: Number(row.amount || 0),
    note: row.note || '',
    source: row.source || 'manual'
  }))

export const buildPenaltyDetailRows = (summaryRows = []) => {
  const details = []
  summaryRows.forEach(row => {
    const employeeName = row.employeeName || row.employeeCode || row.employeeId || ''
    const employeeId = row.employeeId || ''
    const employeeCode = row.employeeCode || ''
    const days = row.days instanceof Map ? row.days : new Map(Object.entries(row.days || {}))
    days.forEach((day, date) => {
      if (!day) return
      const lateMinutes = Number(day.lateMinutes || 0)
      const earlyMinutes = Number(day.earlyMinutes || 0)

      if (day.late && lateMinutes > 0) {
        const over30 = lateMinutes >= 30
        details.push({
          id: `p-auto-${employeeId}-${date}-late`,
          date,
          employeeId,
          employeeCode,
          employeeName,
          category: over30 ? 'Muộn/sớm ≥30p' : 'Muộn/sớm <30p',
          content: `Đi muộn ${lateMinutes} phút`,
          amount: over30 ? 100000 : 50000,
          note: '',
          source: 'auto'
        })
      }

      if (day.early && earlyMinutes > 0) {
        const over30 = earlyMinutes >= 30
        details.push({
          id: `p-auto-${employeeId}-${date}-early`,
          date,
          employeeId,
          employeeCode,
          employeeName,
          category: over30 ? 'Muộn/sớm ≥30p' : 'Muộn/sớm <30p',
          content: `Về sớm ${earlyMinutes} phút`,
          amount: over30 ? 100000 : 50000,
          note: '',
          source: 'auto'
        })
      }

      if (day.missingPunch) {
        details.push({
          id: `p-auto-${employeeId}-${date}-missing`,
          date,
          employeeId,
          employeeCode,
          employeeName,
          category: 'Quên chấm',
          content: 'Quên chấm công (thiếu vào/ra)',
          amount: 50000,
          note: '',
          source: 'auto'
        })
      }

      if (day.unapprovedAbsence) {
        details.push({
          id: `p-auto-${employeeId}-${date}-absence`,
          date,
          employeeId,
          employeeCode,
          employeeName,
          category: 'Nghỉ không phép',
          content: 'Nghỉ không phép',
          amount: 200000,
          note: '',
          source: 'auto'
        })
      }
    })
  })

  return details.sort((left, right) => {
    const byDate = String(left.date).localeCompare(String(right.date))
    if (byDate !== 0) return byDate
    return String(left.employeeName).localeCompare(String(right.employeeName), 'vi')
  })
}
