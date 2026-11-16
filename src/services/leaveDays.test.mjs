import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const calls = []
let responses = {}
globalThis.__leaveDaysTestSupabase = {
  from(table) {
    const query = { table, operations: [] }
    calls.push(query)
    const chain = Object.fromEntries(['select', 'eq', 'order', 'range', 'update', 'insert', 'delete', 'in'].map(method => [method, (...args) => {
      query.operations.push([method, ...args])
      return chain
    }]))
    chain.then = (resolve, reject) => Promise.resolve(responses[table] || { data: [], error: null }).then(resolve, reject)
    chain.single = chain.maybeSingle = () => Promise.resolve(responses[table] || { data: null, error: null })
    return chain
  },
  async rpc(name, args) {
    calls.push({ rpc: name, args })
    return responses.rpc || { data: { id: 'day-1' }, error: null }
  }
}
const source = (await readFile(new URL('./leaveDays.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from './supabase'", 'const supabase = globalThis.__leaveDaysTestSupabase')
  .replace("'../utils/leaveDays'", JSON.stringify(new URL('../utils/leaveDays.js', import.meta.url).href))
const { loadLeaveDays, loadLeaveDayDetails, adjustLeaveDay } = await import(`data:text/javascript,${encodeURIComponent(source)}`)

test('danh sách giới hạn theo công ty/nhân sự và không tải nội dung tệp', async () => {
  calls.length = 0
  responses = { employee_leave_days: { data: [{ id: 'day-1' }], error: null } }
  assert.equal((await loadLeaveDays({ companyId: 'company', employeeId: 'employee' })).length, 1)
  const operations = calls[0].operations
  assert.ok(operations.some(op => op[0] === 'eq' && op[1] === 'company_id' && op[2] === 'company'))
  assert.ok(operations.some(op => op[0] === 'eq' && op[1] === 'employee_id' && op[2] === 'employee'))
  assert.ok(!operations.find(op => op[0] === 'select')[1].includes('adjustment_history'))
})

test('chi tiết tải đúng đề xuất và bỏ qua đề xuất khác nhân sự/công ty', async () => {
  const day = { id: 'day-1', employee_id: 'employee', approval_request_id: 'approvalRequests::request-1', adjustment_history: [] }
  responses = {
    employee_leave_days: { data: day, error: null },
    hr_records: { data: { data: { requesterId: 'employee', companyId: 'company', attachments: [{ name: 'proof.txt', data: 'data:text/plain;base64,aGk=' }] } }, error: null }
  }
  const result = await loadLeaveDayDetails({ companyId: 'company', id: 'day-1' })
  assert.equal(result.approval.id, 'request-1')
  assert.equal(result.approval.attachments[0].data, 'data:text/plain;base64,aGk=')
  responses.hr_records.data.data.companyId = 'other-company'
  assert.equal((await loadLeaveDayDetails({ companyId: 'company', id: 'day-1' })).approval, null)
  responses.hr_records.data = null
  assert.equal((await loadLeaveDayDetails({ companyId: 'company', id: 'day-1' })).approval_request_id, 'approvalRequests::request-1')
})

test('điều chỉnh gửi ghi chú, tệp và phiên bản vào RPC nguyên tử', async () => {
  calls.length = 0
  responses = {}
  const input = { id: 'day-1', leaveDate: '2026-11-16', reason: 'Nghỉ có phép', note: '  Đổi ngày nghỉ  ', attachments: [{ name: 'proof.txt', size: 2, data: 'data:text/plain;base64,aGk=' }], expectedUpdatedAt: '2026-11-16T01:00:00Z' }
  await adjustLeaveDay(input)
  assert.equal(calls[0].rpc, 'adjust_employee_leave_day')
  assert.equal(calls[0].args.p_note, 'Đổi ngày nghỉ')
  assert.equal(calls[0].args.p_expected_updated_at, input.expectedUpdatedAt)
  assert.deepEqual(calls[0].args.p_attachments, input.attachments)
  await assert.rejects(adjustLeaveDay({ ...input, note: '' }), /Ghi chú/)
  assert.equal(calls.length, 1)
  responses.rpc = { data: null, error: { code: '23505' } }
  await assert.rejects(adjustLeaveDay(input), /đã có ngày nghỉ/)
})
