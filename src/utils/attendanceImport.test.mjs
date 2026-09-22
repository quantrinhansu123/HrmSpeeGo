import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeAttendanceSheet,
  collectAttendancePunches,
  findMatrixDayHeader,
  findAttendancePunchColumns,
  mapAttendanceColumns,
  parseAttendanceDate,
  parseAttendanceTime
} from './attendanceImport.js'

test('finds numbered punch pairs in the August attendance export', () => {
  const headers = [
    'Mã N.Viên', 'Tên nhân viên', 'Ngày',
    'Vào 1', 'Ra 1', 'Vào 2', 'Ra 2', 'Vào 3', 'Ra 3',
    'Vào Trễ', 'Ra sớm'
  ]

  assert.deepEqual(findAttendancePunchColumns(headers), {
    checkInIndexes: [3, 5, 7],
    checkOutIndexes: [4, 6, 8],
    allIndexes: [3, 4, 5, 6, 7, 8]
  })
})

test('supports a simple Vào/Ra pair without including summary columns', () => {
  const headers = ['Mã NV', 'Vào', 'Ra', 'Vào trễ', 'Ra sớm']

  assert.deepEqual(findAttendancePunchColumns(headers), {
    checkInIndexes: [1],
    checkOutIndexes: [2],
    allIndexes: [1, 2]
  })
})

test('uses the first Vào and last actual Ra instead of an unmatched later Vào', () => {
  const columns = findAttendancePunchColumns([
    'Mã NV', 'Vào 1', 'Ra 1', 'Vào 2', 'Ra 2'
  ])
  const result = collectAttendancePunches(
    ['00001', '08:26', '17:36', '17:58', ''],
    columns
  )

  assert.deepEqual(result, {
    checkIn: '08:26',
    checkOut: '17:36',
    punches: ['08:26', '17:36', '17:58'],
    punchPairs: [
      { checkIn: '08:26', checkOut: '17:36' },
      { checkIn: '17:58', checkOut: '' }
    ]
  })
})

test('keeps a lone Ra as checkout instead of converting it to check-in', () => {
  const columns = findAttendancePunchColumns(['Mã NV', 'Vào 1', 'Ra 1'])
  const result = collectAttendancePunches(['00001', '', '17:30'], columns)

  assert.equal(result.checkIn, '')
  assert.equal(result.checkOut, '17:30')
})

test('keeps the first Vào and last Ra when a split-shift punch is unmatched', () => {
  const columns = findAttendancePunchColumns([
    'Mã NV', 'Vào 1', 'Ra 1', 'Vào 2', 'Ra 2'
  ])
  const result = collectAttendancePunches(
    ['00001', '08:00', '12:00', '', '17:30'],
    columns
  )

  assert.equal(result.checkIn, '08:00')
  assert.equal(result.checkOut, '17:30')
  assert.deepEqual(result.punchPairs, [
    { checkIn: '08:00', checkOut: '12:00' },
    { checkIn: '', checkOut: '17:30' }
  ])
})

test('parses Excel serial times and AM/PM without dropping the meridiem', () => {
  assert.equal(parseAttendanceTime(0.5).str, '12:00')
  assert.equal(parseAttendanceTime('8:30 AM').str, '08:30')
  assert.equal(parseAttendanceTime('8:30 PM').str, '20:30')
  assert.equal(parseAttendanceTime('12:05 AM').str, '00:05')
})

test('prefers Vietnamese day/month order for ambiguous text dates', () => {
  assert.equal(parseAttendanceDate('01/08/2026'), '2026-08-01')
  assert.equal(parseAttendanceDate('8/27/2026'), '2026-08-27')
  assert.equal(parseAttendanceDate(46235), '2026-08-01')
})

test('maps reordered Vietnamese and English attendance headers', () => {
  const headers = [
    'Check-out', 'HỌ VÀ TÊN', 'Attendance Date', 'Employee Code',
    'Check-in', 'Bộ phận', 'Công+', 'Tổng giờ'
  ]

  assert.deepEqual(mapAttendanceColumns(headers), {
    code: 3,
    name: 1,
    machineName: -1,
    department: 5,
    position: -1,
    date: 2,
    weekday: -1,
    workdays: -1,
    hours: 7,
    extraWorkdays: 6,
    extraHours: -1,
    shift: -1,
    symbol: -1,
    extraSymbol: -1,
    totalHours: 7,
    lateMinutes: -1,
    earlyMinutes: -1,
    overtime1: -1,
    overtime2: -1,
    overtime3: -1
  })
})

test('chooses the real matrix header instead of a numeric employee row', () => {
  const rows = [
    ['BẢNG CÔNG T8/2026'],
    ['Họ tên', 'Bộ phận', ...Array.from({ length: 31 }, (_, index) => index + 1)],
    ['Nguyễn Văn A', 'Sale', ...Array(25).fill(1), 2, 6, 21, 21, 26, 26]
  ]

  const result = findMatrixDayHeader(rows)
  assert.equal(result.rowIndex, 1)
  assert.deepEqual(result.days, Array.from({ length: 31 }, (_, index) => index + 1))
})

test('accepts paired day columns but rejects a non-consecutive numeric summary row', () => {
  const pairedDays = Array.from({ length: 10 }, (_, index) => [index + 1, index + 1]).flat()
  const rows = [
    ['Mã NV', 'Tên NV', ...pairedDays],
    ['NV01', 'Nguyễn Văn A', 1, 1, 1, 1, 2, 6, 21, 21, 26, 26]
  ]

  const result = findMatrixDayHeader(rows)
  assert.equal(result.rowIndex, 0)
  assert.deepEqual(result.days, Array.from({ length: 10 }, (_, index) => index + 1))
})

test('scores an attendance detail sheet above a reconciliation sheet', () => {
  const reconciliationRows = [
    ['Mã máy', 'Tên từ máy/file', 'Mã NV Lumi', 'Kết quả'],
    ['001', 'Nguyễn Văn A', 'NV01', 'Đã ghép']
  ]
  const detailRows = [
    ['Ghi chú xuất dữ liệu'],
    ['Employee Code', 'Employee Name', 'Work Date', 'Time In', 'Time Out'],
    ['NV01', 'Nguyễn Văn A', '2026-08-01', '08:00', '17:00']
  ]

  assert.equal(analyzeAttendanceSheet(reconciliationRows).score, 0)
  assert.equal(analyzeAttendanceSheet(detailRows).kind, 'list')
  assert.ok(analyzeAttendanceSheet(detailRows).score > 0)
})
