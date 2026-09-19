import { attendanceTimeToMinutes } from './attendanceShift.js'

/**
 * Một ngày công đủ được quy đổi từ đúng 480 phút làm việc thực tế.
 * Không dùng số giờ đã làm tròn từ Excel để tính lại tổng tháng.
 */
export const STANDARD_WORK_MINUTES = 8 * 60

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
export const roundDecimal = (value, digits = 2) => {
  const factor = 10 ** digits
  return Math.round((finiteNumber(value) + Number.EPSILON) * factor) / factor
}

const firstPresent = (...values) =>
  values.find(value => value !== null && value !== undefined && String(value).trim() !== '')

/**
 * Tính số phút giữa cặp Vào/Ra. Ca đêm được nối sang ngày kế tiếp thay vì
 * tạo số âm. `breakMinutes` chỉ được trừ khi được cấu hình rõ ràng; mặc định
 * dữ liệu chấm công được tính đúng theo chênh lệch Vào → Ra.
 */
export const calculateWorkedMinutes = ({
  checkIn,
  checkOut,
  breakMinutes = 0
} = {}) => {
  const inMinutes = attendanceTimeToMinutes(checkIn)
  const outMinutes = attendanceTimeToMinutes(checkOut)
  if (inMinutes === null || outMinutes === null) return null

  let elapsed = outMinutes - inMinutes
  if (elapsed < 0) elapsed += 24 * 60
  if (elapsed <= 0) return 0

  const unpaidBreak = Math.max(0, finiteNumber(breakMinutes))
  return Math.max(0, elapsed - unpaidBreak)
}

const manualOvertimeHours = log => {
  const fields = ['tc1', 'tc2', 'tc3']
  const hasManualValue = fields.some(field =>
    log && log[field] !== null && log[field] !== undefined &&
    String(log[field]).trim() !== '' && finiteNumber(log[field]) > 0
  )
  if (!hasManualValue) return { hasValue: false, hours: 0 }

  return {
    hasValue: true,
    hours: Math.max(0, fields.reduce((total, field) => total + finiteNumber(log[field]), 0))
  }
}

const punchInterval = pair => {
  const start = attendanceTimeToMinutes(pair?.checkIn)
  const rawEnd = attendanceTimeToMinutes(pair?.checkOut)
  if (start === null || rawEnd === null) return null
  const end = rawEnd < start ? rawEnd + 24 * 60 : rawEnd
  return end > start ? { start, end, minutes: end - start } : null
}

const sessionInterval = session => {
  const start = attendanceTimeToMinutes(session?.start)
  const rawEnd = attendanceTimeToMinutes(session?.end)
  if (start === null || rawEnd === null) return null
  const end = rawEnd < start ? rawEnd + 24 * 60 : rawEnd
  return end > start ? { start, end, minutes: end - start } : null
}

const overlapMinutes = (left, right) =>
  Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start))

const normalizePunchPairs = punchPairs => (punchPairs || [])
  .map(pair => ({
    checkIn: firstPresent(pair?.checkIn),
    checkOut: firstPresent(pair?.checkOut)
  }))
  .filter(pair => pair.checkIn || pair.checkOut)

const buildSplitSessions = splitShift => [
  { key: 'morning', label: 'Buổi sáng', ...splitShift?.morning },
  { key: 'afternoon', label: 'Buổi chiều', ...splitShift?.afternoon }
].map(session => ({
  ...session,
  interval: sessionInterval(session),
  workdays: Math.min(1, Math.max(0, finiteNumber(session.workdays, 0.5)))
}))

/**
 * Tính fallback cho dữ liệu chia buổi bị thiếu một lượt Vào hoặc Ra.
 * Khi đó máy vẫn có thể cung cấp một Vào đầu và một Ra cuối, nên dùng
 * đúng khoảng đầu-cuối thay vì bỏ qua lượt chấm bị thiếu.
 */
const calculatePartialSplitSpanWork = ({
  punchPairs = [],
  splitShift,
  breakMinutes = 0
} = {}) => {
  if (!splitShift?.enabled) return null

  const pairs = normalizePunchPairs(punchPairs)
  const hasIncompletePair = pairs.some(pair => Boolean(pair.checkIn) !== Boolean(pair.checkOut))
  if (!hasIncompletePair) return null

  const checkIn = pairs.find(pair => pair.checkIn)?.checkIn
  const checkOut = [...pairs].reverse().find(pair => pair.checkOut)?.checkOut
  if (!checkIn || !checkOut) return null

  const workedMinutes = calculateWorkedMinutes({ checkIn, checkOut, breakMinutes })
  if (workedMinutes === null) return null

  const sessions = buildSplitSessions(splitShift)
  if (sessions.some(session => !session.interval)) return null

  const start = attendanceTimeToMinutes(checkIn)
  const rawEnd = attendanceTimeToMinutes(checkOut)
  if (start === null || rawEnd === null) return null
  const end = rawEnd < start ? rawEnd + 24 * 60 : rawEnd
  const span = { start, end }
  const coveredSessions = sessions.filter(session => overlapMinutes(span, session.interval) > 0)
  const regularWorkdays = coveredSessions.length === 1
    ? coveredSessions[0].workdays
    : coveredSessions.length > 1
      ? 1
      : 0

  return {
    workedMinutes,
    regularWorkdays,
    calculationMode: 'full-day',
    splitShiftBreakdown: []
  }
}

/**
 * Tính công theo hai buổi khi ca bật chia buổi.
 * - Một cặp phủ cả sáng lẫn chiều vẫn dùng công thức full ngày.
 * - Từ hai cặp hợp lệ trở lên, hoặc một cặp chỉ nằm trong một buổi, tính trọn
 *   mức công tối đa đã cấu hình cho từng buổi.
 */
export const calculateSplitShiftWork = ({ punchPairs = [], splitShift } = {}) => {
  if (!splitShift?.enabled) return null
  const rawPairs = normalizePunchPairs(punchPairs)
  // A missing Vào/Ra is handled by the first-to-last fallback in
  // calculateAttendanceMetrics. Do not silently discard the unmatched punch
  // and calculate only from the remaining complete pairs.
  if (rawPairs.some(pair => Boolean(pair.checkIn) !== Boolean(pair.checkOut))) return null

  const sessions = buildSplitSessions(splitShift)
  if (sessions.some(session => !session.interval)) return null

  const pairs = rawPairs.map(punchInterval).filter(Boolean)
  if (!pairs.length) return null
  const overlaps = sessions.map(session =>
    pairs.reduce((total, pair) => total + overlapMinutes(pair, session.interval), 0)
  )
  const coveredSessions = overlaps.filter(minutes => minutes > 0).length
  if (pairs.length === 1 && coveredSessions > 1) return null
  if (pairs.length === 1 && coveredSessions === 0) return null

  const breakdown = sessions.map((session, index) => {
    const creditedMinutes = Math.min(overlaps[index], session.interval.minutes)
    return {
      key: session.key,
      label: session.label,
      minutes: creditedMinutes,
      workdays: creditedMinutes > 0 ? session.workdays : 0
    }
  })
  const attendedSessions = breakdown.filter(session => session.minutes > 0)

  return {
    workedMinutes: pairs.reduce((total, pair) => total + pair.minutes, 0),
    regularWorkdays: attendedSessions.length > 1
      ? 1
      : attendedSessions.reduce((total, session) => total + session.workdays, 0),
    breakdown
  }
}

/**
 * Tính Công/Giờ/Tăng ca cho một bản ghi.
 *
 * - Có đủ Vào/Ra: luôn lấy phút thực tế từ hai mốc giờ, bỏ qua `hours`,
 *   `tongGio` và `cong` cũ do máy/Excel gửi lên.
 * - Không có Vào/Ra: giữ số giờ/công nguồn để không làm mất dữ liệu import
 *   dạng mã công (1, 0.5, P...).
 * - Tăng ca thủ công (TC1/TC2/TC3) luôn được ưu tiên. Tự động tách phần vượt
 *   480 phút chỉ chạy khi bản ghi không đánh dấu `overtimeAutoDisabled`.
 */
export const calculateAttendanceMetrics = ({
  log = {},
  checkIn = firstPresent(log.checkIn, log.vao),
  checkOut = firstPresent(log.checkOut, log.ra),
  standardMinutes = STANDARD_WORK_MINUTES,
  breakMinutes = 0,
  autoCalculateOvertime = true,
  punchPairs = log.punchPairs,
  splitShift,
  fallbackHours,
  fallbackWorkdays
} = {}) => {
  const standard = Math.max(1, finiteNumber(standardMinutes, STANDARD_WORK_MINUTES))
  const partialSplitMetrics = calculatePartialSplitSpanWork({
    punchPairs,
    splitShift,
    breakMinutes
  })
  const splitMetrics = calculateSplitShiftWork({ punchPairs, splitShift })
  const activeSplitMetrics = partialSplitMetrics || splitMetrics
  const workedMinutes = activeSplitMetrics?.workedMinutes ?? calculateWorkedMinutes({ checkIn, checkOut, breakMinutes })
  const hasPunchPair = workedMinutes !== null
  const manual = manualOvertimeHours(log)
  const sourceHours = finiteNumber(
    firstPresent(fallbackHours, log.hours, log.soGio, log.gio),
    0
  )

  if (!hasPunchPair) {
    const sourceWorkdays = fallbackWorkdays !== undefined && fallbackWorkdays !== null
      ? Math.max(0, finiteNumber(fallbackWorkdays))
      : Math.min(Math.max(0, sourceHours * 60) / standard, 1)
    return {
      hasPunchPair: false,
      workedMinutes: Math.max(0, sourceHours * 60),
      regularMinutes: Math.min(Math.max(0, sourceHours * 60), standard),
      overtimeMinutes: manual.hasValue ? manual.hours * 60 : 0,
      hours: Math.max(0, sourceHours),
      regularWorkdays: sourceWorkdays,
      overtimeHours: manual.hasValue ? manual.hours : 0,
      overtimeSource: manual.hasValue ? 'manual' : 'none'
    }
  }

  const regularMinutes = Math.min(workedMinutes, standard)
  const excessMinutes = Math.max(0, workedMinutes - standard)
  const automaticAllowed = autoCalculateOvertime && !log.overtimeAutoDisabled
  const overtimeHours = manual.hasValue
    ? manual.hours
    : automaticAllowed
      ? excessMinutes / 60
      : 0

  return {
    hasPunchPair: true,
    workedMinutes,
    regularMinutes,
    overtimeMinutes: overtimeHours * 60,
    // Giờ công chuẩn không vượt quá một ca chính. Phần vượt chuẩn được
    // phản ánh riêng qua overtimeHours, nên ca 08:30–17:30 là 8 giờ công,
    // không phải 9 giờ công.
    hours: regularMinutes / 60,
    regularWorkdays: activeSplitMetrics?.regularWorkdays ?? regularMinutes / standard,
    overtimeHours,
    overtimeSource: manual.hasValue ? 'manual' : automaticAllowed ? 'automatic' : 'disabled',
    calculationMode: partialSplitMetrics?.calculationMode || (splitMetrics ? 'split-shift' : 'full-day'),
    splitShiftBreakdown: partialSplitMetrics?.splitShiftBreakdown || splitMetrics?.breakdown || []
  }
}

export const getAttendanceHoliday = (date, attendanceSettings = {}) => {
  const dateKey = String(date || '').slice(0, 10)
  if (!dateKey) return null
  const holidays = Array.isArray(attendanceSettings?.holidays)
    ? attendanceSettings.holidays
    : []
  return holidays
    .map(item => {
      if (typeof item === 'string') return { date: item.slice(0, 10), name: '' }
      return {
        date: String(item?.date || item?.day || '').slice(0, 10),
        name: String(item?.name || item?.label || '').trim()
      }
    })
    .find(item => item.date === dateKey) || null
}

/**
 * Mô tả công thức công ngày để hiện tooltip / chú thích trên bảng ma trận.
 */
export const describeDayWorkFormula = (day = {}, {
  standardMinutes = STANDARD_WORK_MINUTES,
  displayCode = ''
} = {}) => {
  const code = String(displayCode || '').trim().toUpperCase()
  const standard = Math.max(1, finiteNumber(standardMinutes, STANDARD_WORK_MINUTES))
  const checkIn = String(day.checkIn || day.vao || '').trim()
  const checkOut = String(day.checkOut || day.ra || '').trim()
  const workedMinutes = finiteNumber(
    day.workedMinutes,
    checkIn && checkOut
      ? (calculateWorkedMinutes({ checkIn, checkOut }) || 0)
      : finiteNumber(day.hoursExact ?? day.hours) * 60
  )
  const workdays = finiteNumber(day.workdaysExact ?? day.workdays)
  const holidayLabel = day.holidayName
    ? `Ngày lễ: ${day.holidayName}`
    : (day.isHoliday ? 'Ngày lễ' : '')

  if (day.manualOverride) {
    return `Chỉnh tay: ${roundDecimal(workdays)} công`
  }

  if (code === 'P1' || code === 'P' || finiteNumber(day.paidLeaveWorkdays) > 0) {
    const leave = finiteNumber(day.paidLeaveWorkdays, workdays || 1)
    return `Phép (P1) = ${roundDecimal(leave)} công${holidayLabel ? ` · ${holidayLabel}` : ''}`
  }

  if (day.calculationMode === 'split-shift' && Array.isArray(day.splitShiftBreakdown)) {
    const sessions = day.splitShiftBreakdown.filter(session =>
      finiteNumber(session?.minutes) > 0 || finiteNumber(session?.workdays) > 0
    )
    if (sessions.length) {
      const details = sessions.map(session =>
        `${session.label || 'Buổi'} ${Math.round(finiteNumber(session.minutes))}p = ${roundDecimal(session.workdays)} công`
      )
      return `Chia 2 buổi: ${details.join(' · ')} · Tổng ${roundDecimal(workdays)} công${holidayLabel ? ` · ${holidayLabel}` : ''}`
    }
  }

  if (holidayLabel && workdays <= 0 && !checkIn && !checkOut) {
    return `${holidayLabel} — không tự tính công`
  }

  if (checkIn && checkOut) {
    const capped = Math.min(workedMinutes, standard)
    const cong = roundDecimal(capped / standard, 4)
    const parts = [
      `${checkIn}→${checkOut} = ${Math.round(workedMinutes)}p`,
      `÷ ${standard}p = ${roundDecimal(cong)} công`
    ]
    if (workedMinutes > standard) parts.push('(tối đa 1 công/ngày)')
    if (holidayLabel) parts.push(holidayLabel)
    return parts.join(' · ')
  }

  const hours = finiteNumber(day.hoursExact ?? day.hours)
  if (hours > 0) {
    const cong = roundDecimal(Math.min(hours * 60, standard) / standard, 4)
    return `Giờ nguồn ${roundDecimal(hours)}h ÷ ${standard / 60}h = ${roundDecimal(cong)} công${holidayLabel ? ` · ${holidayLabel}` : ''}`
  }

  if (workdays > 0) {
    return `Công nguồn = ${roundDecimal(workdays)}${holidayLabel ? ` · ${holidayLabel}` : ''}`
  }

  return holidayLabel || ''
}

