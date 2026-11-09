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

test('59 phút giữ công; đúng 60 và 65 phút cộng muộn/sớm trừ toàn bộ, không phạt', () => {
  for (const [vao, ra, minutes] of [['09:00', '17:01', 59], ['09:00', '17:00', 60], ['09:05', '17:00', 65]]) {
    const rows = summarize([[vao, ra]])
    const day = rows[0].days.get('2026-08-01')
    assert.equal(day.lateMinutes + day.earlyMinutes, minutes)
    assert.ok(Math.abs(day.workdaysExact - (minutes < 60 ? 1 : (480 - minutes) / 480)) < 1e-9)
    assert.equal(applyPenaltyAmountsToSummaryRows(rows)[0].lateFine, minutes < 60 ? 100000 : 0)
  }
})

test('ngày từ 60 phút không dùng lượt miễn và không cộng tổng phút phạt tháng', () => {
  const rows = summarize([['09:40', '17:30'], ['08:40', '17:30'], ['08:40', '17:30']])
  assert.equal(applyPenaltyAmountsToSummaryRows(rows)[0].lateFine, 0)
  const withThird = summarize([['09:40', '17:30'], ['08:40', '17:30'], ['08:40', '17:30'], ['08:35', '17:30']])
  assert.equal(applyPenaltyAmountsToSummaryRows(withThird)[0].lateFine, 50000)
})

test('đơn đã duyệt miễn công/phạt đúng người và ngày, vẫn lưu số phút trong snapshot', () => {
  const approved = { templateId: 'late-early', requesterId: 'e1', status: 'approved', attendanceDate: '2026-08-01' }
  const rows = summarize([['09:40', '17:30'], ['08:50', '17:30']], [approved])
  const day = rows[0].days.get('2026-08-01')
  assert.equal(day.workdaysExact, 1)
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
  }
  const [manual] = summarize([['09:40', '17:30']], [approved], { manualWorkdays: { e1: { 1: 0.5 } } })
  assert.equal(manual.workdays, 0.5)
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
    [[['09:40', '17:30']], 0]
  ]) {
    const workbook = await buildAttendanceWorkbook(template, summarize(times), '2026-08')
    const sheet = workbook.worksheets[0]
    assert.equal(sheet.getCell('M7').value + sheet.getCell('O7').value, amount)
  }
})
