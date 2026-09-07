import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectAttendancePunches,
  findAttendancePunchColumns,
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
    punches: ['08:26', '17:36', '17:58']
  })
})

test('keeps a lone Ra as checkout instead of converting it to check-in', () => {
  const columns = findAttendancePunchColumns(['Mã NV', 'Vào 1', 'Ra 1'])
  const result = collectAttendancePunches(['00001', '', '17:30'], columns)

  assert.equal(result.checkIn, '')
  assert.equal(result.checkOut, '17:30')
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
