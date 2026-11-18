// Tháng áp dụng đã được HCNS chốt: tháng 11/2026, không hồi tố kỳ trước.
export const ATTENDANCE_POINTS_START_MONTH = '2026-11'
export const isAttendancePointsMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || '')) && month >= ATTENDANCE_POINTS_START_MONTH
export const ATTENDANCE_POINT_TYPES = [
  { key: 'late', label: 'Đi muộn không phép' },
  { key: 'early', label: 'Về sớm không phép' },
  { key: 'outside', label: 'Ra ngoài không phép' },
  { key: 'missing_punch', label: 'Quên chấm không giải trình được' },
  { key: 'absence', label: 'Nghỉ không phép' },
  { key: 'conduct', label: 'Vi phạm trang phục / trật tự / vệ sinh' },
  { key: 'emergency_leave', label: 'Nghỉ đột xuất không lý do chính đáng (chỉ ghi tần suất)' }
]
export const ATTENDANCE_BENEFIT_GROUPS = [
  { key: 'unassigned', label: 'Chưa xác định', maximum: null },
  { key: 'employee', label: 'Nhân viên chính thức', maximum: 1000000 },
  { key: 'manager', label: 'Quản lý chính thức', maximum: 2000000 },
  { key: 'ineligible', label: 'Không thuộc diện hưởng', maximum: 0 }
]
export const isTimedPointEvent = type => ['late', 'early', 'outside'].includes(type)
export const pointRuleForEvent = (type, minutes = 0) => {
  if (isTimedPointEvent(type)) {
    const value = Number(minutes)
    if (!Number.isFinite(value) || value <= 0) return { categoryKey: '', points: 0 }
    return value < 30 ? { categoryKey: 'time_under_30', points: 10 }
      : value <= 60 ? { categoryKey: 'time_30_60', points: 20 }
        : { categoryKey: 'time_over_60', points: 30 }
  }
  const rules = {
    missing_punch: { categoryKey: 'missing_punch', points: 10 },
    absence: { categoryKey: 'unapproved_absence', points: 40 },
    conduct: { categoryKey: 'conduct', points: 10 },
    emergency_leave: { categoryKey: 'frequency_only', points: 0 }
  }
  return rules[type] || { categoryKey: '', points: 0 }
}

export const normalizePointEvent = (row = {}) => ({
  ...row,
  policyVersion: 'points-v0.4',
  amount: 0,
  points: row.points === '' ? NaN : Number(row.points ?? 0),
  minutes: Number(row.minutes || 0),
  eventType: row.eventType || 'late',
  categoryKey: row.categoryKey || '',
  reviewStatus: !row.reviewStatus || row.reviewStatus === 'pending' ? 'confirmed' : row.reviewStatus,
  pointsOverridden: row.pointsOverridden === true,
  note: row.note || '',
  source: row.source === 'auto' ? 'auto' : 'manual'
})

export const createManualPointEvent = month => normalizePointEvent({
  id: `p-manual-${globalThis.crypto.randomUUID()}`,
  date: `${month}-01`, employeeId: '', employeeCode: '', employeeName: '',
  eventType: 'late', minutes: 1, ...pointRuleForEvent('late', 1), content: '', source: 'manual'
})

// Snapshot mới tách từng lượt; snapshot cũ chỉ có cờ ngày thì cần HCNS đối soát.
// Sự kiện áp dụng trừ điểm ngay; admin có thể điều chỉnh sau.
export const buildAttendancePointEvents = (summaryRows = []) => {
  const result = []
  for (const row of summaryRows) {
    const days = row.days instanceof Map ? row.days : new Map(Object.entries(row.days || {}))
    days.forEach((day, date) => {
      if (!day || !isAttendancePointsMonth(String(date).slice(0, 7))) return
      const push = (eventType, minutes = 0, occurrenceKey = eventType) => {
        const rule = pointRuleForEvent(eventType, minutes)
        if (!rule.categoryKey) return
        const label = ATTENDANCE_POINT_TYPES.find(item => item.key === eventType)?.label || ''
        result.push(normalizePointEvent({
          id: `p-point-${row.employeeId}-${date}-${occurrenceKey}`,
          date, month: String(date).slice(0, 7),
          employeeId: row.employeeId || '', employeeCode: row.employeeCode || '',
          employeeName: row.employeeName || row.employeeCode || '',
          eventType, minutes, ...rule,
          category: label,
          content: `${label}${minutes > 0 ? ` · ${minutes} phút` : ''}`,
          source: 'auto', reviewStatus: 'confirmed'
        }))
      }
      // Đơn approved cũ chưa phân biệt phạm vi muộn/sớm: vẫn cần HCNS xác nhận
      // miễn từng sự kiện, thay vì bỏ toàn bộ ngày khỏi nhật ký.
      if (Array.isArray(day.lateEarlyOccurrences)) {
        day.lateEarlyOccurrences.forEach(event => {
          if (['late', 'early'].includes(event.type) && Number(event.minutes) > 0) push(event.type, Number(event.minutes), event.key)
        })
      } else {
        if (day.late && Number(day.lateMinutes) > 0) push('late', Number(day.lateMinutes))
        if (day.early && Number(day.earlyMinutes) > 0) push('early', Number(day.earlyMinutes))
      }
      if (Array.isArray(day.missingPunchOccurrences) && day.missingPunchOccurrences.length) {
        day.missingPunchOccurrences.forEach(event => push('missing_punch', 0, event.key))
      } else if (day.missingPunch) push('missing_punch')
      if (day.unapprovedAbsence) push('absence')
      if (day.lateEarlyApproved) {
        result.filter(item => item.employeeId === row.employeeId && item.date === date && isTimedPointEvent(item.eventType))
          .forEach(item => { item.note = 'Có đơn muộn/sớm đã duyệt trong ngày. HCNS kiểm tra phạm vi đơn để miễn điểm.' })
      }
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName, 'vi') || a.id.localeCompare(b.id))
}

export const mergeAttendancePointEvents = (existing = [], generated = []) => {
  const previous = new Map(existing.filter(row => row.source === 'auto').map(row => [row.id, row]))
  const automatic = generated.map(row => {
    const saved = previous.get(row.id)
    if (!saved) return normalizePointEvent(row)
    const sameEvent = saved.employeeId === row.employeeId && saved.date === row.date && saved.eventType === row.eventType
    const unchanged = sameEvent && Number(saved.minutes) === Number(row.minutes)
    return normalizePointEvent({
      ...row,
      ...(sameEvent && saved.pointsOverridden ? { points: saved.points, pointsOverridden: true } : {}),
      ...(unchanged ? { note: saved.note, reviewStatus: saved.reviewStatus, reviewedAt: saved.reviewedAt, reviewedBy: saved.reviewedBy } : {
        note: 'Dữ liệu chấm công đã thay đổi; đã cập nhật điểm trừ.', reviewStatus: 'confirmed', reviewedAt: null, reviewedBy: null
      })
    })
  })
  return [...existing.filter(row => row.source !== 'auto').map(normalizePointEvent), ...automatic]
}

export const summarizeEmployeePoints = (rows = [], employeeId, group = 'unassigned') => {
  const events = rows.filter(row => String(row.employeeId) === String(employeeId))
  const confirmed = events.filter(row => ['confirmed', 'pending', undefined, null, ''].includes(row.reviewStatus))
  const deductedPoints = confirmed.reduce((sum, row) => sum + Math.max(0, Number(row.points) || 0), 0)
  const pendingPoints = 0
  const pendingCount = 0
  const remainingPoints = Math.max(0, 100 - deductedPoints)
  const maximum = ATTENDANCE_BENEFIT_GROUPS.find(item => item.key === group)?.maximum ?? null
  const frequencyCount = confirmed.filter(row => ['late', 'early', 'outside', 'emergency_leave'].includes(row.eventType)).length
  const absenceDays = new Set(confirmed.filter(row => row.eventType === 'absence').map(row => row.date)).size
  return {
    deductedPoints, remainingPoints, pendingPoints, pendingCount, maximum,
    benefitAmount: maximum === null ? null : Math.round(maximum * remainingPoints / 100),
    frequencyCount, absenceDays, needsDisciplineReview: frequencyCount >= 4 || absenceDays >= 2
  }
}

export const validatePointEvents = (month, rows) => {
  if (!isAttendancePointsMonth(month)) throw new Error('Quy chế điểm áp dụng từ tháng 11/2026.')
  const ids = new Set()
  const dailyAbsences = new Set()
  const explainedPunches = new Map()
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error('Sự kiện bị trùng mã.')
    ids.add(row.id)
    if (!row.employeeId) throw new Error('Vui lòng chọn nhân viên cho mọi sự kiện.')
    const parsedDate = new Date(`${row.date}T00:00:00Z`)
    if (!String(row.date || '').startsWith(`${month}-`) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== row.date) throw new Error('Ngày sự kiện phải hợp lệ và thuộc tháng đang xem.')
    const rule = pointRuleForEvent(row.eventType, row.minutes)
    if (!rule.categoryKey || rule.categoryKey !== row.categoryKey || !Number.isInteger(Number(row.points)) || Number(row.points) < 0 || Number(row.points) > 100 || (!row.pointsOverridden && rule.points !== Number(row.points)) || !Number.isInteger(Number(row.minutes)) || Number(row.minutes) < 0 || Number(row.minutes) > 1440 || (!isTimedPointEvent(row.eventType) && Number(row.minutes) !== 0)) throw new Error('Loại sự kiện, thời lượng hoặc điểm không hợp lệ (điểm từ 0 đến 100).')
    if (!['pending', 'confirmed', 'exempt'].includes(row.reviewStatus)) throw new Error('Trạng thái kiểm tra không hợp lệ.')
    if (row.reviewStatus === 'exempt' && !String(row.note || '').trim()) throw new Error('Cần ghi lý do khi miễn điểm.')
    if (row.eventType === 'missing_punch' && row.reviewStatus === 'exempt') {
      const count = (explainedPunches.get(row.employeeId) || 0) + 1
      explainedPunches.set(row.employeeId, count)
      if (count > 2) throw new Error('Tối đa 2 lần giải trình quên chấm mỗi người/tháng theo Điều 7.2.')
    }
    if (row.eventType === 'absence' && row.reviewStatus !== 'exempt') {
      const key = `${row.employeeId}::${row.date}`
      if (dailyAbsences.has(key)) throw new Error('Một người chỉ bị trừ điểm nghỉ không phép một lần trong ngày.')
      dailyAbsences.add(key)
    }
  }
  return rows
}

// Sử dụng dữ liệu đã lưu, bao gồm điều chỉnh của admin.
export const attachSavedAttendancePoints = (summaryRows, events, benefits = {}) => summaryRows.map(row => ({
  ...row,
  attendancePoints: summarizeEmployeePoints(events, row.employeeId, benefits[row.employeeId] || 'unassigned'),
  pointEvents: events.filter(event => String(event.employeeId) === String(row.employeeId))
}))
