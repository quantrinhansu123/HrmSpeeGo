import assert from 'node:assert/strict'
import test from 'node:test'
import { formatLeaveDate, isValidLeaveDate, normalizeLeaveReason, todayLocalDate, validateLeaveAdjustment } from './leaveDays.js'

test('chỉ nhận ngày nghỉ hợp lệ, kể cả ngày nhuận', () => {
  assert.equal(isValidLeaveDate('2028-02-29'), true)
  assert.equal(isValidLeaveDate('2027-02-29'), false)
  assert.equal(isValidLeaveDate('2026-13-01'), false)
  assert.equal(isValidLeaveDate(''), false)
})

test('hiển thị ngày nghỉ và lấy ngày hiện tại theo giờ địa phương', () => {
  assert.equal(formatLeaveDate('2026-09-24'), '24/09/2026')
  assert.equal(todayLocalDate(new Date(2026, 8, 24)), '2026-09-24')
})

test('lý do chỉ nhận Nghỉ cố định hoặc Nghỉ có phép', () => {
  assert.equal(normalizeLeaveReason('  Nghỉ cố định  '), 'Nghỉ cố định')
  assert.equal(normalizeLeaveReason('Nghỉ có phép'), 'Nghỉ có phép')
  assert.throws(() => normalizeLeaveReason('Việc gia đình'), /Vui lòng chọn lý do/)
  assert.throws(() => normalizeLeaveReason('   '), /Vui lòng chọn lý do/)
})

test('điều chỉnh phải có ngày hợp lệ và ghi chú rõ ràng', () => {
  const input = { leaveDate: '2026-11-16', reason: 'Nghỉ có phép', note: '  Đổi ngày nghỉ theo xác nhận của HR  ' }
  assert.equal(validateLeaveAdjustment(input).note, 'Đổi ngày nghỉ theo xác nhận của HR')
  assert.deepEqual(validateLeaveAdjustment(input).attachments, [])
  assert.throws(() => validateLeaveAdjustment({ ...input, note: '   ' }), /Ghi chú/)
  assert.throws(() => validateLeaveAdjustment({ ...input, note: 'a'.repeat(2001) }), /Ghi chú/)
  assert.throws(() => validateLeaveAdjustment({ ...input, leaveDate: '2026-02-30' }), /ngày nghỉ hợp lệ/)
  assert.throws(() => validateLeaveAdjustment({ ...input, reason: 'Khác' }), /lý do/)
})
