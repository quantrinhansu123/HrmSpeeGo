import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (await readFile(new URL('./approvalLeave.js', import.meta.url), 'utf8'))
  .replace("'./helpers'", JSON.stringify(new URL('./helpers.js', import.meta.url).href))
const { isLeaveRequest, leaveDaysOutsideRequests } = await import(`data:text/javascript,${encodeURIComponent(source)}`)

test('lọc nghỉ phép bao gồm phép năm, không lương, việc riêng và mẫu nghỉ cũ', () => {
  for (const request of [
    { templateId: 'leave', leaveType: 'paid' },
    { templateBaseId: 'leave', leaveType: 'unpaid' },
    { templateId: 'custom', leaveStartDate: '2026-11-18', leaveType: 'personal_paid' },
    { leaveDate: '2026-11-18' },
    { attendanceSync: 'paid-leave' },
    { templateType: 'Đơn xin nghỉ phép' }
  ]) assert.equal(isLeaveRequest(request), true)
  for (const request of [{}, { templateId: 'late-early', attendanceDate: '2026-11-18' }, { templateId: 'proposal' }]) {
    assert.equal(isLeaveRequest(request), false)
  }
})

test('lịch sử giữ ngày thêm trực tiếp và đề xuất đã xóa, không lặp ngày thuộc đơn hiện có', () => {
  const records = [
    { id: 'manual', approval_request_id: null },
    { id: 'linked', approval_request_id: 'approvalRequests::request-1' },
    { id: 'deleted', approval_request_id: 'approvalRequests::old-request', adjustment_count: 2 },
    { id: 'logical', approval_request_id: 'request-2' }
  ]
  const result = leaveDaysOutsideRequests(records, [{ id: 'request-1' }, { id: 'approvalRequests::request-2' }])
  assert.deepEqual(result.map(record => record.id), ['manual', 'deleted'])
  assert.equal(result[1].adjustment_count, 2)
  assert.equal(leaveDaysOutsideRequests(records, []).length, 4)
})
