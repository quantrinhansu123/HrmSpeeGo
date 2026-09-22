export const normalizeAttendanceHeader = value =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeHeader = normalizeAttendanceHeader

const HEADER_ALIASES = Object.freeze({
  code: [
    'ma nguon', 'ma may', 'ma cham cong', 'ma n vien', 'ma nhan vien',
    'ma nv', 'employee id', 'employee code', 'staff id', 'staff code', 'code'
  ],
  name: [
    'ten nguon', 'ten tu may file', 'ten theo may', 'ten cham cong',
    'ten nhan vien', 'ho va ten', 'ho ten', 'ten nv', 'employee name',
    'full name', 'name'
  ],
  machineName: ['ten theo may', 'ten may', 'ten cham cong', 'ten tu may file', 'ten nguon'],
  department: ['phong ban nguon', 'phong ban', 'bo phan', 'department', 'team'],
  position: ['chuc vu nguon', 'chuc vu', 'vi tri', 'position', 'job title'],
  date: ['ngay cham cong', 'ngay cong', 'attendance date', 'work date', 'ngay', 'date'],
  weekday: ['thu trong tuan', 'day of week', 'weekday', 'thu'],
  workdays: ['tong cong', 'ngay cong', 'so cong', 'workdays', 'workday', 'cong'],
  hours: ['so gio', 'hours worked', 'work hours', 'hours', 'gio'],
  extraWorkdays: ['cong them', 'cong plus'],
  extraHours: ['gio them', 'gio plus'],
  shift: ['ten ca', 'ca lam viec', 'ca lam', 'shift'],
  symbol: ['ki hieu', 'ky hieu', 'status code', 'attendance code'],
  extraSymbol: ['ki hieu plus', 'ky hieu plus'],
  totalHours: ['tong gio', 'total hours'],
  lateMinutes: ['vao tre', 'di tre', 'late minutes'],
  earlyMinutes: ['ra som', 've som', 'early minutes'],
  overtime1: ['tc1', 'tang ca 1', 'ot1'],
  overtime2: ['tc2', 'tang ca 2', 'ot2'],
  overtime3: ['tc3', 'tang ca 3', 'ot3']
})

const headerMatchScore = (header, alias) => {
  if (!header || !alias) return 0
  if (header === alias) return 100 + alias.length
  if (header.startsWith(`${alias} `) || header.endsWith(` ${alias}`)) return 70 + alias.length
  if (alias.length >= 5 && header.includes(alias)) return 40 + alias.length
  return 0
}

/**
 * Map attendance fields without depending on column order or punctuation.
 * Exact aliases win over broad/partial aliases (for example "Tổng giờ" over "Giờ").
 */
export const mapAttendanceColumns = (headers = []) => {
  const normalized = headers.map(normalizeAttendanceHeader)
  const result = {}

  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    let bestIndex = -1
    let bestScore = 0
    normalized.forEach((header, index) => {
      if (['workdays', 'hours', 'symbol'].includes(field) && header.includes(' plus')) return
      aliases.forEach((alias, aliasIndex) => {
        const score = headerMatchScore(header, alias) - aliasIndex / 100
        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      })
    })
    result[field] = bestIndex
  })

  return result
}

export const extractAttendanceDay = cell => {
  if (cell === null || cell === undefined || cell === '') return null

  if (typeof cell === 'number') {
    if (Number.isInteger(cell) && cell >= 1 && cell <= 31) return { day: cell }
    if (cell >= 35000 && cell <= 65000) {
      const date = new Date(Math.round((cell - 25569) * 86400 * 1000))
      return {
        day: date.getUTCDate(),
        month: date.getUTCMonth() + 1,
        year: date.getUTCFullYear()
      }
    }
    return null
  }

  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return { day: cell.getDate(), month: cell.getMonth() + 1, year: cell.getFullYear() }
  }

  const value = String(cell).trim()
  if (/^\d{1,2}$/.test(value)) {
    const day = Number(value)
    return day >= 1 && day <= 31 ? { day } : null
  }

  const vietnameseDate = value.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?$/)
  if (vietnameseDate) {
    const day = Number(vietnameseDate[1])
    const month = Number(vietnameseDate[2])
    let year = vietnameseDate[3] ? Number(vietnameseDate[3]) : undefined
    if (year !== undefined && year < 100) year += 2000
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { day, month, year }
  }

  const isoDate = value.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/)
  if (isoDate) {
    const day = Number(isoDate[3])
    const month = Number(isoDate[2])
    const year = Number(isoDate[1])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { day, month, year }
  }

  return null
}

const attendanceHeaderSignals = row => {
  const columns = mapAttendanceColumns(row)
  return Object.values(columns).filter(index => index >= 0).length
}

const buildMatrixCandidate = (rows, rowIndex) => {
  const row = rows[rowIndex] || []
  const columns = []
  row.forEach((cell, index) => {
    const info = extractAttendanceDay(cell)
    if (info) columns.push({ ...info, idx: index })
  })

  const uniqueDays = [...new Set(columns.map(column => column.day))]
  const isMonotonic = columns.every((column, index) =>
    index === 0 || column.day >= columns[index - 1].day
  )
  const consecutivePairs = uniqueDays.slice(1).filter((day, index) => day === uniqueDays[index] + 1).length
  const consecutiveRatio = uniqueDays.length <= 1
    ? 0
    : consecutivePairs / (uniqueDays.length - 1)
  const occurrences = uniqueDays.map(day => columns.filter(column => column.day === day).length)
  const repeatedEvenly = occurrences.length > 0 && Math.max(...occurrences) <= 4 &&
    Math.max(...occurrences) - Math.min(...occurrences) <= 1
  const hasSafeRepeats = columns.length === uniqueDays.length || repeatedEvenly
  const nearbyHeaderSignals = Array.from({ length: 5 }, (_, offset) => rowIndex - 3 + offset)
    .filter(index => index >= 0 && index < rows.length)
    .reduce((max, index) => Math.max(max, attendanceHeaderSignals(rows[index] || [])), 0)
  const valid = uniqueDays.length >= 5 && isMonotonic && consecutiveRatio >= 0.8 && hasSafeRepeats
  const score = valid
    ? 10000 + uniqueDays.length * 100 + nearbyHeaderSignals * 20 - (columns.length - uniqueDays.length) * 2
    : 0

  return {
    rowIndex,
    columns,
    days: uniqueDays,
    uniqueDayCount: uniqueDays.length,
    consecutiveRatio,
    nearbyHeaderSignals,
    valid,
    score
  }
}

/** Find a real 1..31 header sequence, not a numeric employee data row. */
export const findMatrixDayHeader = (rows = [], maxRows = 60) => {
  let best = null
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, maxRows); rowIndex++) {
    const candidate = buildMatrixCandidate(rows, rowIndex)
    if (candidate.valid && (!best || candidate.score > best.score)) best = candidate
  }
  return best
}

const listHeaderCandidate = (rows, rowIndex) => {
  const headers = rows[rowIndex] || []
  const columns = mapAttendanceColumns(headers)
  const punches = findAttendancePunchColumns(headers)
  const normalized = headers.map(normalizeAttendanceHeader)
  const numberedPunches = normalized.reduce((count, header) =>
    count + Number(/^(?:lan|cham|punch|scan|time)\s*\d+$/.test(header)), 0)
  const hasIdentity = columns.code >= 0 || columns.name >= 0
  const hasDate = columns.date >= 0
  const hasAttendanceValue = punches.allIndexes.length > 0 || numberedPunches > 0 ||
    columns.workdays >= 0 || columns.hours >= 0 || columns.symbol >= 0
  const valid = hasIdentity && hasDate && hasAttendanceValue
  const signalCount = Object.values(columns).filter(index => index >= 0).length
  const score = valid
    ? 5000 + signalCount * 50 + punches.allIndexes.length * 20 + numberedPunches * 20
    : 0
  const hasFullMetrics = columns.workdays >= 0 || columns.hours >= 0 ||
    columns.extraWorkdays >= 0 || columns.extraHours >= 0 || columns.symbol >= 0 ||
    columns.totalHours >= 0 || columns.overtime1 >= 0

  return {
    rowIndex,
    headers,
    columns,
    punches,
    numberedPunches,
    valid,
    score,
    format: numberedPunches > 0 ? 'punch' : (hasFullMetrics ? 'full' : 'list')
  }
}

export const findAttendanceListHeader = (rows = [], maxRows = 60) => {
  let best = null
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, maxRows); rowIndex++) {
    const candidate = listHeaderCandidate(rows, rowIndex)
    if (candidate.valid && (!best || candidate.score > best.score)) best = candidate
  }
  return best
}

/** Score one worksheet so instruction/summary tabs do not beat the attendance tab. */
export const analyzeAttendanceSheet = (rows = []) => {
  const matrix = findMatrixDayHeader(rows)
  const list = findAttendanceListHeader(rows)
  const best = matrix && (!list || matrix.score >= list.score) ? matrix : list
  return {
    kind: best === matrix && matrix ? 'matrix' : (list ? list.format : ''),
    score: best?.score || 0,
    matrix,
    list
  }
}

export const parseAttendanceTime = (timeRaw) => {
  if (timeRaw === null || timeRaw === undefined || timeRaw === '') return null

  if (typeof timeRaw === 'number') {
    const fraction = timeRaw > 1 ? timeRaw % 1 : timeRaw
    if (fraction <= 0 || fraction >= 1) return null
    const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return { h, m, val: h + m / 60, str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
  }

  const value = String(timeRaw).trim()
  if (!value || value === '-' || value === '------') return null

  const meridiem = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])\.?M\.?$/i)
  if (meridiem) {
    const rawHour = Number(meridiem[1])
    const m = Number(meridiem[2])
    if (rawHour < 1 || rawHour > 12 || m > 59) return null
    const h = (rawHour % 12) + (meridiem[3].toUpperCase() === 'P' ? 12 : 0)
    return { h, m, val: h + m / 60, str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
  }

  const clock = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (clock) {
    const h = Number(clock[1])
    const m = Number(clock[2])
    if (h > 23 || m > 59) return null
    return { h, m, val: h + m / 60, str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
  }

  const numeric = Number(value.replace(',', '.'))
  return Number.isFinite(numeric) && numeric > 0 && numeric < 1
    ? parseAttendanceTime(numeric)
    : null
}

export const parseAttendanceDate = (dateRaw) => {
  if (dateRaw === null || dateRaw === undefined || dateRaw === '') return null

  if (typeof dateRaw === 'number') {
    const date = new Date(Math.round((dateRaw - 25569) * 86400 * 1000))
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }

  const value = String(dateRaw).trim()
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)

  const match = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (match) {
    const first = Number(match[1])
    const second = Number(match[2])
    const year = Number(match[3])
    const month = first > 12 ? second : second > 12 ? first : second
    const day = first > 12 ? first : second > 12 ? second : first
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/**
 * Locate only real punch columns (Vào/Ra, Vào 1/Ra 1, ...).
 * Summary columns such as "Vào trễ" and "Ra sớm" must not be treated as punches.
 */
export const findAttendancePunchColumns = (headers = []) =>
  headers.reduce((columns, header, index) => {
    const normalized = normalizeHeader(header)
    if (/^(?:vao|check in|checkin|time in)\s*\d*$/.test(normalized)) {
      columns.checkInIndexes.push(index)
      columns.allIndexes.push(index)
    } else if (/^(?:ra|check out|checkout|time out)\s*\d*$/.test(normalized)) {
      columns.checkOutIndexes.push(index)
      columns.allIndexes.push(index)
    }
    return columns
  }, { checkInIndexes: [], checkOutIndexes: [], allIndexes: [] })

export const collectAttendancePunches = (
  row = [],
  columns = { checkInIndexes: [], checkOutIndexes: [], allIndexes: [] },
  parseValue = value => value
) => {
  const parsedAt = index => {
    const parsed = parseValue(row[index])
    return typeof parsed === 'string' ? parsed : parsed?.str || ''
  }
  const checkIns = columns.checkInIndexes.map(parsedAt).filter(Boolean)
  const checkOuts = columns.checkOutIndexes.map(parsedAt).filter(Boolean)
  const punches = columns.allIndexes.map(parsedAt).filter(Boolean)
  const punchPairs = Array.from({
    length: Math.max(columns.checkInIndexes.length, columns.checkOutIndexes.length)
  }, (_, index) => ({
    checkIn: parsedAt(columns.checkInIndexes[index]),
    checkOut: parsedAt(columns.checkOutIndexes[index])
  })).filter(pair => pair.checkIn || pair.checkOut)

  return {
    checkIn: checkIns[0] || '',
    checkOut: checkOuts[checkOuts.length - 1] || '',
    punches,
    punchPairs
  }
}
