import { normalizeString } from './helpers.js'

export const DEFAULT_ATTENDANCE_SHIFT = Object.freeze({
  name: 'Ca Hành chính',
  start: '08:30',
  end: '17:30'
})

export const SALE_ATTENDANCE_SHIFT = Object.freeze({
  name: 'Ca Sáng Sale',
  start: '04:00',
  end: '13:30'
})

export const ATTENDANCE_SHIFT_IDS = Object.freeze({
  ADMINISTRATIVE: 'administrative',
  SALE_MORNING: 'saleMorning'
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

const normalizeConfiguredShift = (id, value, fallback) => {
  const source = value && typeof value === 'object' ? value : {}
  return {
    id,
    name: String(source.name || fallback.name).trim() || fallback.name,
    standardCheckIn: normalizeTime(source.standardCheckIn || source.start) || fallback.start,
    standardCheckOut: normalizeTime(source.standardCheckOut || source.end) || fallback.end
  }
}

export const normalizeAttendanceShiftSettings = (settings = {}) => {
  const source = settings && typeof settings === 'object' ? settings : {}
  const storedShifts = source.shifts && typeof source.shifts === 'object'
    ? source.shifts
    : {}
  const findStoredShift = id => Array.isArray(storedShifts)
    ? storedShifts.find(shift => shift?.id === id)
    : storedShifts[id]
  const administrativeSource = findStoredShift(ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE)
  const legacyAdministrative = administrativeSource || {
    standardCheckIn: source.standardCheckIn,
    standardCheckOut: source.standardCheckOut
  }

  return {
    timezone: source.timezone || 'Asia/Ho_Chi_Minh',
    shifts: {
      [ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE]: normalizeConfiguredShift(
        ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE,
        legacyAdministrative,
        DEFAULT_ATTENDANCE_SHIFT
      ),
      [ATTENDANCE_SHIFT_IDS.SALE_MORNING]: normalizeConfiguredShift(
        ATTENDANCE_SHIFT_IDS.SALE_MORNING,
        findStoredShift(ATTENDANCE_SHIFT_IDS.SALE_MORNING),
        SALE_ATTENDANCE_SHIFT
      )
    }
  }
}

export const getAttendanceShiftOptions = settings =>
  Object.values(normalizeAttendanceShiftSettings(settings).shifts)

export const buildAttendanceShiftSettingsPayload = settings => {
  const normalized = normalizeAttendanceShiftSettings(settings)
  const administrative = normalized.shifts[ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE]
  return {
    timezone: normalized.timezone,
    shifts: normalized.shifts,
    // Giữ hai trường cũ để các bản triển khai chưa cập nhật vẫn đọc đúng ca hành chính.
    standardCheckIn: administrative.standardCheckIn,
    standardCheckOut: administrative.standardCheckOut
  }
}

const shiftFromConfiguration = (shift, settings) => {
  const configured = normalizeAttendanceShiftSettings(settings).shifts[shift]
  return configured
    ? {
        name: configured.name,
        start: configured.standardCheckIn,
        end: configured.standardCheckOut
      }
    : null
}

const configuredShiftFromName = (value, settings) => {
  const normalizedName = normalizeString(value)
  if (!normalizedName) return null
  const configured = normalizeAttendanceShiftSettings(settings).shifts

  const exact = Object.values(configured).find(shift =>
    normalizeString(shift.id) === normalizedName ||
    normalizeString(shift.name) === normalizedName
  )
  if (exact) {
    return {
      name: exact.name,
      start: exact.standardCheckIn,
      end: exact.standardCheckOut
    }
  }

  if (/\b(sale|sales)\b/.test(normalizedName) || normalizedName.includes('kinh doanh')) {
    return shiftFromConfiguration(ATTENDANCE_SHIFT_IDS.SALE_MORNING, settings)
  }
  if (['ca hanh chinh', 'hanh chinh', 'ca full', 'ca ngay', 'ngay'].includes(normalizedName)) {
    return shiftFromConfiguration(ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE, settings)
  }
  return null
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
  const position = normalizeString(
    employee?.vi_tri || employee?.position || log?.position || log?.chucVu || ''
  )
  if (/xuat nhap khau|thu mua|ke toan|van hanh|admin|nhan su|\bhr\b|designer|content|media|leader/.test(position)) {
    return false
  }

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

  const isSaleRole = department === 'trang' ||
    /(^|\s)(sale|sales)(\s|$)/.test(identity) ||
    identity.includes('kinh doanh')

  if (!isSaleRole) return false

  const checkIn = firstValue(log?.vao, log?.checkIn)
  if (checkIn) {
    const mins = attendanceTimeToMinutes(checkIn)
    if (mins !== null && mins >= 6 * 60 + 30) {
      return false
    }
  }

  return true
}

export const resolveAttendanceShift = (employee = {}, log = {}, settings = {}) => {
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

  const employeeConfiguredShift = configuredShiftFromName(
    firstValue(...employeeShiftFields(employee)),
    settings
  )
  const logConfiguredShift = configuredShiftFromName(
    firstValue(log.shiftName, log.tenCa),
    settings
  )

  // Dữ liệu cũ thường gán "Ca full/Ca ngày" cho mọi người; bộ phận Sale vẫn phải
  // dùng ca Sale. Tên ca Sale rõ ràng trong hồ sơ hoặc log luôn được nhận diện.
  if (employeeIsSale(employee, log)) {
    return configuredShiftFromName('Ca Sáng Sale', settings) || SALE_ATTENDANCE_SHIFT
  }
  if (employeeConfiguredShift) return employeeConfiguredShift
  if (logConfiguredShift) return logConfiguredShift

  return shiftFromConfiguration(ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE, settings) || DEFAULT_ATTENDANCE_SHIFT
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

export const calculateAttendanceTiming = ({
  employee = {},
  log = {},
  checkIn,
  checkOut,
  attendanceSettings = {}
} = {}) => {
  const shift = resolveAttendanceShift(employee, log, attendanceSettings)
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

export const applyCalculatedAttendanceTiming = (log = {}, employee = {}, attendanceSettings = {}) => {
  const timing = calculateAttendanceTiming({ employee, log, attendanceSettings })
  const lateMinutes = timing.hasCheckIn
    ? timing.lateMinutes
    : numericValue(log.lateMinutes ?? log.vaoTre)
  const earlyMinutes = timing.hasCheckOut
    ? timing.earlyMinutes
    : numericValue(log.earlyMinutes ?? log.raSom)

  return {
    ...log,
    shiftName: log.shiftName || log.tenCa || timing.shift.name,
    tenCa: log.tenCa || log.shiftName || timing.shift.name,
    lateMinutes,
    earlyMinutes,
    vaoTre: lateMinutes,
    raSom: earlyMinutes
  }
}
