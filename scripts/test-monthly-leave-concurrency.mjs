// After monthly_leave_accrual.sql in a disposable local database ONLY.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
const exec = promisify(execFile)
const [database, port = '55439', binary = 'C:/Program Files/PostgreSQL/17/bin/psql.exe'] = process.argv.slice(2)
if (!database?.startsWith('monthly_leave_test')) throw new Error('A disposable monthly_leave_test database is required')
const sql = statement => exec(binary, ['-X', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement])
const request = (start, end) => JSON.stringify({ templateId: 'leave', subject: 'Concurrent leave', content: 'Concurrent balance check',
  leaveStartDate: start, leaveEndDate: end, leaveDuration: 'full', leaveType: 'paid', leaveEmergency: true, leaveEmergencyReason: 'Emergency concurrency test' })
const submit = (start, end) => sql(`BEGIN; SET test.employee='00000000-0000-4000-8000-000000000001'; SELECT public.submit_employee_approval('${request(start, end)}'); SELECT pg_sleep(1); COMMIT;`)
const results = await Promise.allSettled([submit('2026-11-24', '2026-11-27'), submit('2026-12-01', '2026-12-04')])
assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, 'exactly one simultaneous four-day request succeeds with 5.5 days available')
assert.match(results.find(r => r.status === 'rejected').reason.stderr, /không đủ phép/)
const balance = await sql("SET test.employee='00000000-0000-4000-8000-000000000001'; SELECT public.my_approval_leave_balance(2026)->>'remaining';")
assert.equal(Number(balance.stdout.trim().split(/\r?\n/).at(-1)), 1.5)
console.log('Concurrent requests cannot overspend the leave balance.')
