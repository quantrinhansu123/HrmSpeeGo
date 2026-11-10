import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildAttendanceSummary, serializeAttendanceSummaryRows } from './attendanceSummary.js'
import { applyPenaltyAmountsToSummaryRows, buildPenaltyDetailRows } from './attendancePenalties.js'
import { buildAttendanceWorkbook } from './attendanceExcel.js'

const employee = { id: 'e1', employeeId: 'NV001', shift: 'Ca Hành chính' }
const attendanceSettings = {
  standardWorkMinutes: 480,
  unpaidBreakMinutes: 60,
  shifts: { administrative: { name: 'Ca Hành chính', standardCheckIn: '08:30', standardCheckOut: '17:30' } }
}
const summarize = (times, approvalRequests = [], extra = {}) => buildAttendanceSummary({
  employees: [employee], month: '2026-08', attendanceSettings, approvalRequests,
  attendanceLogs: times.map(([vao, ra], index) => ({ employeeId: 'e1', date: `2026-08-${String(index + 1).padStart(2, '0')}`, vao, ra })),
  ...extra
})

test('59 phút giữ công; đúng 60 và 65 phút trừ công; cả ba trường hợp đều phạt', () => {
  for (const [vao, ra, minutes] of [['09:00', '17:01', 59], ['09:00', '17:00', 60], ['09:05', '17:00', 65]]) {
    const rows = summarize([[vao, ra]])
    const day = rows[0].days.get('2026-08-01')
    assert.equal(day.lateMinutes + day.earlyMinutes, minutes)
    assert.ok(Math.abs(day.workdaysExact - (minutes < 60 ? 1 : (480 - minutes) / 480)) < 1e-9)
    assert.equal(applyPenaltyAmountsToSummaryRows(rows)[0].lateFine, 100000)
    assert.equal(buildPenaltyDetailRows(rows)[0].amount, 100000)
  }
})

const splitAttendanceSettings = {
  ...attendanceSettings,
  shifts: {
    administrative: {
      ...attendanceSettings.shifts.administrative,
      splitShift: {
        enabled: true,
        morning: { start: '08:30', end: '12:00', workdays: 0.5 },
        afternoon: { start: '13:30', end: '17:30', workdays: 0.5 }
      }
    }
  }
}

test('02/11 vào 08:39 ra 17:40: muộn 9 phút vẫn đủ 1 công khi ca chia buổi chỉ có 450 phút', () => {
  const rows = summarize([], [], {
    month: '2026-11',
    attendanceSettings: splitAttendanceSettings,
    attendanceLogs: [{ employeeId: 'e1', date: '2026-11-02', vao: '08:39', ra: '17:40' }]
  })
  const day = rows[0].days.get('2026-11-02')
  assert.equal(day.lateMinutes, 9)
  assert.equal(day.earlyMinutes, 0)
  assert.equal(day.hours, 7.35)
  assert.equal(day.workdaysExact, 1)
  assert.equal(rows[0].workdays, 1)
  assert.equal(serializeAttendanceSummaryRows(rows)[0].days['2026-11-02'].workdays, 1)
})

test('ca chia buổi miễn đúng công từng buổi dưới 60 phút và giữ ngưỡng trừ công', () => {
  for (const [vao, ra, expected] of [
    ['08:39', '12:00', 0.5],
    ['13:39', '17:30', 0.5],
    ['08:30', '17:21', 1],
    ['09:00', '17:01', 1],
    ['09:00', '17:00', 180 / 210 * 0.5 + 210 / 240 * 0.5]
  ]) {
    const rows = summarize([[vao, ra]], [], { attendanceSettings: splitAttendanceSettings })
    assert.equal(rows[0].days.get('2026-08-01').workdaysExact, expected, `${vao}–${ra}`)
  }
  const rows = summarize([['09:40', '17:30']], [
    { templateId: 'late-early', requesterId: 'e1', status: 'approved', attendanceDate: '2026-08-01' }
  ], { attendanceSettings: splitAttendanceSettings })
  assert.equal(rows[0].days.get('2026-08-01').workdaysExact, 140 / 210 * 0.5 + 0.5)
})

test('miễn muộn ca chia buổi không bù khoảng trống giữa các lượt chấm', () => {
  const rows = summarize([], [], {
    attendanceSettings: splitAttendanceSettings,
    attendanceLogs: [{
      employeeId: 'e1', date: '2026-08-01',
      punchPairs: [
        { checkIn: '08:39', checkOut: '10:00' },
        { checkIn: '11:00', checkOut: '17:30' }
      ]
    }]
  })
  const day = rows[0].days.get('2026-08-01')
  assert.equal(day.lateMinutes, 9)
  assert.equal(day.workdaysExact, 150 / 210 * 0.5 + 0.5)
})

test('ngày từ 60 phút được tính vào lượt và tổng phút phạt tháng', () => {
  const rows = summarize([['09:40', '17:30'], ['08:40', '17:30'], ['08:40', '17:30']])
  const [penalty] = buildPenaltyDetailRows(rows)
  assert.equal(penalty.amount, 100000)
  assert.match(penalty.content, /3 lần, tổng 90 phút/)
  assert.equal(applyPenaltyAmountsToSummaryRows(rows)[0].lateFine, 100000)
  const withThird = summarize([['09:40', '17:30'], ['08:40', '17:30'], ['08:40', '17:30'], ['08:35', '17:30']])
  assert.equal(applyPenaltyAmountsToSummaryRows(withThird)[0].lateFine, 100000)
})

test('đơn đã duyệt chỉ miễn phạt đúng người và ngày, vẫn trừ công và lưu số phút', () => {
  const approved = { templateId: 'late-early', requesterId: 'e1', status: 'approved', attendanceDate: '2026-08-01' }
  const rows = summarize([['09:40', '17:30'], ['08:50', '17:30']], [approved])
  const day = rows[0].days.get('2026-08-01')
  assert.ok(Math.abs(day.workdaysExact - 410 / 480) < 1e-9)
  assert.equal(day.lateMinutes, 70)
  assert.equal(day.hoursExact, 410 / 60)
  assert.equal(day.lateEarlyApproved, true)
  assert.equal(applyPenaltyAmountsToSummaryRows(rows)[0].lateFine, 50000)
  assert.equal(buildPenaltyDetailRows(rows).length, 1)
  const storedDay = serializeAttendanceSummaryRows(rows)[0].days['2026-08-01']
  assert.equal(storedDay.lateEarlyApproved, true)
  assert.equal(storedDay.lateMinutes, 70)
  for (const patch of [{ status: 'pending' }, { status: 'rejected' }, { requesterId: 'other' }, { attendanceDate: '2026-08-02' }, { attendanceDate: undefined }, { templateId: 'leave' }]) {
    const [row] = summarize([['09:40', '17:30']], [{ ...approved, ...patch }])
    assert.equal(row.days.get('2026-08-01').lateEarlyApproved, false)
    assert.ok(row.workdays < 1)
    assert.equal(applyPenaltyAmountsToSummaryRows([row])[0].lateFine, 100000)
  }
  const [manual] = summarize([['09:40', '17:30']], [approved], { manualWorkdays: { e1: { 1: 0.5 } } })
  assert.equal(manual.workdays, 0.5)
})

test('đơn đã duyệt giữ công dưới 60 phút và vẫn trừ công từ 60 phút cho cả muộn lẫn sớm', () => {
  const approved = { templateId: 'late-early', requesterId: 'e1', status: 'approved', attendanceDate: '2026-08-01' }
  for (const [vao, ra, minutes] of [
    ['09:29', '17:30', 59], ['09:30', '17:30', 60], ['09:40', '17:30', 70],
    ['08:30', '16:31', 59], ['08:30', '16:30', 60], ['08:30', '16:20', 70]
  ]) {
    const rows = summarize([[vao, ra]], [approved])
    const day = rows[0].days.get('2026-08-01')
    assert.equal(day.lateMinutes + day.earlyMinutes, minutes)
    assert.ok(Math.abs(day.workdaysExact - (minutes < 60 ? 1 : (480 - minutes) / 480)) < 1e-9)
    assert.equal(applyPenaltyAmountsToSummaryRows(rows)[0].lateFine, 0)
    assert.deepEqual(buildPenaltyDetailRows(rows), [])
  }
})

test('hai lần 20 phút phạt 100k; muộn và sớm dùng chung hai lượt dưới 15 phút', () => {
  assert.equal(applyPenaltyAmountsToSummaryRows(summarize([['08:50', '17:30'], ['08:50', '17:30']]))[0].lateFine, 100000)
  assert.equal(applyPenaltyAmountsToSummaryRows(summarize([['08:40', '17:20']]))[0].lateFine, 0)
  assert.equal(applyPenaltyAmountsToSummaryRows(summarize([['08:40', '17:20'], ['08:35', '17:30']]))[0].lateFine, 50000)
  assert.equal(applyPenaltyAmountsToSummaryRows(summarize([['08:45', '17:30']]))[0].lateFine, 50000)
  assert.equal(applyPenaltyAmountsToSummaryRows(summarize([['09:00', '17:30']]))[0].lateFine, 100000)
})

test('Excel giữ tiền phạt tháng, không nhân theo số lần khi mở lại file', async () => {
  const template = await readFile(new URL('../../public/templates/attendance-report-template.xlsx', import.meta.url))
  for (const [times, amount] of [
    [[['08:40', '17:20']], 0],
    [[['08:50', '17:30'], ['08:50', '17:30']], 100000],
    [[['09:40', '17:30']], 100000]
  ]) {
    const workbook = await buildAttendanceWorkbook(template, summarize(times), '2026-08')
    const sheet = workbook.worksheets[0]
    assert.equal(sheet.getCell('M7').value + sheet.getCell('O7').value, amount)
  }
})
