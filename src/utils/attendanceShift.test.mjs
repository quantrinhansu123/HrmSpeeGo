import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCalculatedAttendanceTiming,
  calculateAttendanceTiming,
  formatAttendanceTime,
  resolveAttendanceShift
} from './attendanceShift.js'

test('uses the normal morning shift for a non-Sale employee', () => {
  const result = calculateAttendanceTiming({
    employee: { position: 'HR', shift: 'Ca ngày' },
    checkIn: '08:45',
    checkOut: '17:20'
  })

  assert.equal(result.shift.start, '08:30')
  assert.equal(result.shift.end, '17:30')
  assert.equal(result.lateMinutes, 15)
  assert.equal(result.earlyMinutes, 10)
})

test('uses 04:00-13:30 for an employee identified as Sale', () => {
  const result = calculateAttendanceTiming({
    employee: { department: 'Trang', position: 'Sale', shift: 'Ca ngày' },
    checkIn: '04:15',
    checkOut: '13:20'
  })

  assert.equal(result.shift.start, '04:00')
  assert.equal(result.shift.end, '13:30')
  assert.equal(result.lateMinutes, 15)
  assert.equal(result.earlyMinutes, 10)
})

test('reuses the existing Trang team mapping to identify Sale employees', () => {
  const result = resolveAttendanceShift({ department: 'Trang', position: '' })
  assert.equal(result, resolveAttendanceShift({ position: 'Sale' }))
})

test('prefers an explicit shift range in the attendance row over Sale inference', () => {
  const result = resolveAttendanceShift(
    { position: 'Sale' },
    { shiftName: 'Ca điều động 09:00 - 18:00' }
  )
  assert.equal(result.start, '09:00')
  assert.equal(result.end, '18:00')
})

test('prefers an explicit time range stored in the employee shift', () => {
  assert.deepEqual(
    resolveAttendanceShift({ shift: 'Ca riêng 07:15 - 16:45', position: 'Sale' }),
    { name: 'Ca riêng 07:15 - 16:45', start: '07:15', end: '16:45' }
  )
})

test('keeps actual punch strings while replacing incorrect source penalties', () => {
  const log = applyCalculatedAttendanceTiming({
    vao: '04:02',
    ra: '13:38',
    lateMinutes: 0,
    earlyMinutes: 202
  }, { position: 'Sale' })

  assert.equal(log.vao, '04:02')
  assert.equal(log.ra, '13:38')
  assert.equal(log.lateMinutes, 2)
  assert.equal(log.earlyMinutes, 0)
})

test('formats stored timestamps in the attendance timezone', () => {
  assert.equal(formatAttendanceTime('2026-08-05T21:02:00.000Z'), '04:02')
  assert.equal(formatAttendanceTime('8:30 PM'), '20:30')
})
