import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateAttendanceDetailLog, calculateAttendanceDetailLogs } from './attendanceDetail.js'
import { buildAttendanceSummary, summarizeAttendanceDay } from './attendanceSummary.js'
import { describeDayWorkFormula } from './attendanceCalculations.js'

const employee = { id: 'e1', shift: 'Ca Hành chính' }
const settings = {
  standardWorkMinutes: 480,
  unpaidBreakMinutes: 60,
  shifts: { administrative: {
    name: 'Ca Hành chính', standardCheckIn: '08:30', standardCheckOut: '17:30'
  } }
}
const splitSettings = {
  ...settings,
  shifts: { administrative: {
    ...settings.shifts.administrative,
    splitShift: {
      enabled: true,
      morning: { start: '08:30', end: '12:00', workdays: 0.5 },
      afternoon: { start: '13:30', end: '17:30', workdays: 0.5 }
    }
  } }
}

test('detail display and export replace stale Công with the monthly calculation at the 60-minute boundary', () => {
  for (const attendanceSettings of [settings, splitSettings]) {
    for (const [vao, ra, expectedMinutes] of [
      ['08:39', '17:40', 9], ['09:29', '17:30', 59],
      ['09:30', '17:30', 60], ['09:35', '17:30', 65],
      ['09:00', '17:01', 59], ['09:00', '17:00', 60],
      ['08:30', '16:31', 59], ['08:30', '16:30', 60]
    ]) {
      for (const punches of [{ vao, ra }, { punchPairs: [{ checkIn: vao, checkOut: ra }] }]) {
        const log = { employeeId: 'e1', date: '2026-11-02', cong: 0.88, hours: 7.04, tongGio: 7.04, ...punches }
        const before = structuredClone(log)
        const detail = calculateAttendanceDetailLog(log, employee, attendanceSettings)
        const [summary] = buildAttendanceSummary({
          attendanceLogs: [log], employees: [employee], month: '2026-11', attendanceSettings
        })
        assert.equal(detail.cong, summary.workdays, `${vao}–${ra}`)
        assert.equal(detail.lateMinutes + detail.earlyMinutes, expectedMinutes)
        if (expectedMinutes < 60) assert.equal(detail.cong, 1)
        else assert.ok(detail.cong < 1)
        assert.equal(detail.hours, summary.totalHours)
        assert.equal(detail.tongGio, summary.totalHours)
        assert.deepEqual(log, before)
      }
    }
  }
})

test('split-session detail keeps half days and unpaid gaps between punches', () => {
  const morning = calculateAttendanceDetailLog({ vao: '08:39', ra: '12:00', cong: 0.48 }, employee, splitSettings)
  assert.equal(morning.cong, 0.5)
  const day = calculateAttendanceDetailLog({ punchPairs: [
    { checkIn: '08:39', checkOut: '10:00' },
    { checkIn: '11:00', checkOut: '17:30' }
  ] }, employee, splitSettings)
  assert.equal(day.cong, 0.86)
  assert.equal(day.lateMinutes, 9)
})

test('explicit Excel values, code-only imports and synthetic punches retain their source values', () => {
  for (const log of [
    { vao: '08:39', ra: '17:40', cong: 0.4, hours: 3, calculationMode: 'source-value' },
    { vao: '08:39', ra: '17:40', cong: 0.5, calculationMode: 'matrix-value' },
    { cong: 1, kyHieu: 'P1' },
    { congPlus: 0.5, kyHieuPlus: 'V' },
    { cong: 0.5, syntheticPunch: true, vao: '08:30', ra: '17:30' }
  ]) assert.deepEqual(calculateAttendanceDetailLog(log, employee, settings), log)
})

test('extra workdays, extra hours and manual overtime survive recalculation', () => {
  const log = { vao: '08:39', ra: '17:40', cong: 0.88, congPlus: 0.5, gioPlus: 4, tc1: 2 }
  const detail = calculateAttendanceDetailLog(log, employee, splitSettings)
  assert.equal(detail.cong, 1)
  assert.equal(detail.congPlus, 0.5)
  assert.equal(detail.hours, 7.35)
  assert.equal(detail.tongGio, 11.35)
  assert.equal(detail.tc1, 2)
})

test('detail formula explains why actual worked hours below a full day still receive full credit', () => {
  const day = summarizeAttendanceDay([{ vao: '08:39', ra: '17:30' }], employee, settings)
  assert.match(describeDayWorkFormula(day), /Muộn\/sớm 9p < 60p: không trừ công → 1 công/)
  const deducted = summarizeAttendanceDay([{ vao: '09:30', ra: '17:30' }], employee, settings)
  assert.doesNotMatch(describeDayWorkFormula(deducted), /không trừ công/)
})

test('separate rows use the whole-day threshold and keep employees and dates independent', () => {
  const logs = [
    { employeeId: 'e1', date: '2026-11-02', vao: '09:00', ra: '12:00' },
    { employeeId: 'e1', date: '2026-11-02', vao: '13:30', ra: '17:00' },
    { employeeId: 'e1', date: '2026-11-03', vao: '09:00', ra: '17:01' },
    { employeeId: 'e2', date: '2026-11-02', vao: '09:00', ra: '17:30' }
  ]
  const result = calculateAttendanceDetailLogs(logs, new Map([['e1', employee]]), splitSettings)
  assert.equal(result[0].cong, 0.43)
  assert.equal(result[1].cong, 0.44)
  assert.equal(result[2].cong, 1)
  assert.equal(result[3].cong, 1)
})
