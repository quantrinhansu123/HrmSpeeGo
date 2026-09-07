import { normalizeString } from './helpers.js'

export const DEFAULT_ATTENDANCE_SHIFT = Object.freeze({
  name: 'Ca hành chính',
  start: '08:30',
  end: '17:30'
})

export const SALE_ATTENDANCE_SHIFT = Object.freeze({
  name: 'Ca Sale',
  start: '04:00',
  end: '13:30'
})

const firstValue = (...values) =>
  values.find(value => value !== null && value !== undefined && String(value).trim() !== '')

const normalizeTime = value => {
  const text = String(value || '').trim()
  const meridiem = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])\.?M\.?$/i)
  if (meridiem) {
    const rawHour = Number(meridiem[1])
    const minutes = Number(meridiem[2])
    if (rawHour < 1 || rawHour > 12 || minutes > 59) return ''
    const hours = (rawHour % 12) + (meridiem[3].toUpperCase() === 'P' ? 12 : 0)
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }

  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return ''
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const rangeFromText = value => {
  const match = String(value || '').match(
    /(\d{1,2}:\d{2})\s*(?:-|–|—|đến|tới)\s*(\d{1,2}:\d{2})/i
  )
  if (!match) return null
  const start = normalizeTime(match[1])
  const end = normalizeTime(match[2])
  return start && end ? { start, end } : null
}

const employeeShiftFields = employee => [
  employee?.ca_lam_viec,
  employee?.shift,
  employee?.shiftName,
  employee?.tenCa
]

const employeeIsSale = (employee, log) => {
  const department = normalizeString(
    employee?.bo_phan || employee?.department || log?.department || log?.phongBan || ''
  )
  const identity = normalizeString([
    employee?.bo_phan,
    employee?.department,
    employee?.vi_tri,
    employee?.position,
    ...employeeShiftFields(employee),
    log?.department,
    log?.phongBan,
    log?.position,
    log?.chucVu
  ].filter(Boolean).join(' '))

  return department === 'trang' ||
    /(^|\s)(sale|sales)(\s|$)/.test(identity) ||
    identity.includes('kinh doanh')
}

export const resolveAttendanceShift = (employee = {}, log = {}) => {
  const employeeStart = normalizeTime(firstValue(
    employee.standardCheckIn,
    employee.shiftStart,
    employee.shift_start,
    employee.gio_vao_ca
  ))
  const employeeEnd = normalizeTime(firstValue(
    employee.standardCheckOut,
    employee.shiftEnd,
    employee.shift_end,
    employee.gio_ra_ca
  ))
  if (employeeStart && employeeEnd) {
    return {
      name: firstValue(...employeeShiftFields(employee)) || 'Ca nhân viên',
      start: employeeStart,
      end: employeeEnd
    }
  }

  const employeeRange = employeeShiftFields(employee)
    .map(rangeFromText)
    .find(Boolean)
  if (employeeRange) {
    return {
      name: firstValue(...employeeShiftFields(employee)) || 'Ca nhân viên',
      ...employeeRange
    }
  }

  const logStart = normalizeTime(firstValue(
    log.standardCheckIn,
    log.shiftStart,
    log.shift_start,
    log.gio_vao_ca
  ))
  const logEnd = normalizeTime(firstValue(
    log.standardCheckOut,
    log.shiftEnd,
    log.shift_end,
    log.gio_ra_ca
  ))
  if (logStart && logEnd) {
    return {
      name: firstValue(log.shiftName, log.tenCa) || 'Ca chấm công',
      start: logStart,
      end: logEnd
    }
  }

  const logRange = [log.shiftName, log.tenCa]
    .map(rangeFromText)
    .find(Boolean)
  if (logRange) {
    return {
      name: firstValue(log.shiftName, log.tenCa) || 'Ca chấm công',
      ...logRange
    }
  }

  if (employeeIsSale(employee, log)) return SALE_ATTENDANCE_SHIFT

  return DEFAULT_ATTENDANCE_SHIFT
}

export const attendanceTimeToMinutes = value => {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number' && value > 0 && value < 1) {
    return Math.round(value * 24 * 60) % (24 * 60)
  }

  const direct = normalizeTime(value)
  if (direct) {
    const [hours, minutes] = direct.split(':').map(Number)
    return hours * 60 + minutes
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const hours = Number(parts.find(part => part.type === 'hour')?.value)
  const minutes = Number(parts.find(part => part.type === 'minute')?.value)
  return Number.isFinite(hours) && Number.isFinite(minutes)
    ? hours * 60 + minutes
    : null
}

export const formatAttendanceTime = value => {
  const minutes = attendanceTimeToMinutes(value)
  if (minutes === null) return ''
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export const calculateAttendanceTiming = ({ employee = {}, log = {}, checkIn, checkOut } = {}) => {
  const shift = resolveAttendanceShift(employee, log)
  const actualCheckIn = firstValue(checkIn, log.vao, log.checkIn)
  const actualCheckOut = firstValue(checkOut, log.ra, log.checkOut)
  const checkInMinutes = attendanceTimeToMinutes(actualCheckIn)
  const checkOutMinutes = attendanceTimeToMinutes(actualCheckOut)
  const shiftStartMinutes = attendanceTimeToMinutes(shift.start)
  const shiftEndMinutes = attendanceTimeToMinutes(shift.end)

  return {
    shift,
    hasCheckIn: checkInMinutes !== null,
    hasCheckOut: checkOutMinutes !== null,
    lateMinutes: checkInMinutes === null
      ? null
      : Math.max(0, checkInMinutes - shiftStartMinutes),
    earlyMinutes: checkOutMinutes === null
      ? null
      : Math.max(0, shiftEndMinutes - checkOutMinutes)
  }
}

const numericValue = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const applyCalculatedAttendanceTiming = (log = {}, employee = {}) => {
  const timing = calculateAttendanceTiming({ employee, log })
  const lateMinutes = timing.hasCheckIn
    ? timing.lateMinutes
    : numericValue(log.lateMinutes ?? log.vaoTre)
  const earlyMinutes = timing.hasCheckOut
    ? timing.earlyMinutes
    : numericValue(log.earlyMinutes ?? log.raSom)

  return {
    ...log,
    lateMinutes,
    earlyMinutes,
    vaoTre: lateMinutes,
    raSom: earlyMinutes
  }
}
