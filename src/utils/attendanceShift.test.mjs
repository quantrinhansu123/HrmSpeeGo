import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCalculatedAttendanceTiming,
  buildAttendanceShiftSettingsPayload,
  calculateAttendanceTiming,
  formatAttendanceTime,
  normalizeAttendanceShiftSettings,
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

test('stores and resolves separate times for each configured shift', () => {
  const settings = normalizeAttendanceShiftSettings({
    shifts: {
      administrative: {
        name: 'Ca Hành chính',
        standardCheckIn: '08:35',
        standardCheckOut: '17:40'
      },
      saleMorning: {
        name: 'Ca Sáng Sale',
        standardCheckIn: '04:05',
        standardCheckOut: '13:35'
      }
    }
  })

  assert.deepEqual(
    resolveAttendanceShift({ shift: 'Ca Hành chính', position: 'HR' }, {}, settings),
    { name: 'Ca Hành chính', start: '08:35', end: '17:40' }
  )
  assert.deepEqual(
    resolveAttendanceShift({ shift: 'Ca Sáng Sale', position: 'Sale' }, {}, settings),
    { name: 'Ca Sáng Sale', start: '04:05', end: '13:35' }
  )

  const payload = buildAttendanceShiftSettingsPayload(settings)
  assert.equal(payload.shifts.administrative.standardCheckIn, '08:35')
  assert.equal(payload.shifts.saleMorning.standardCheckIn, '04:05')
  assert.equal(payload.standardCheckIn, '08:35')
})

test('legacy shared settings only change the administrative shift', () => {
  const settings = normalizeAttendanceShiftSettings({
    standardCheckIn: '09:00',
    standardCheckOut: '18:00'
  })

  assert.equal(settings.shifts.administrative.standardCheckIn, '09:00')
  assert.equal(settings.shifts.saleMorning.standardCheckIn, '04:00')
  assert.equal(settings.shifts.saleMorning.standardCheckOut, '13:30')
})

test('reuses the existing Trang team mapping to identify Sale employees', () => {
  const result = resolveAttendanceShift({ department: 'Trang', position: '' })
  assert.deepEqual(result, resolveAttendanceShift({ position: 'Sale' }))
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
