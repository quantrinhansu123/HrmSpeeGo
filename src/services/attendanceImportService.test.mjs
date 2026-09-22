import assert from 'node:assert/strict'
import test from 'node:test'
import { planAttendanceImport } from './attendanceImportService.js'

const imported = overrides => ({
  id: 'old-id',
  employeeId: 'employee-1',
  date: '2026-08-01',
  shiftName: 'Ca ngày',
  vao: '08:00',
  ra: '17:00',
  sourceEmployeeCode: 'M01',
  sourceType: 'excel-import',
  ...overrides
})

test('retrying an unchanged import does not insert another row', () => {
  const existing = imported()
  const incoming = { ...existing }
  delete incoming.id
  const plan = planAttendanceImport({ incomingLogs: [incoming], existingLogs: [existing] })

  assert.equal(plan.inserts.length, 0)
  assert.equal(plan.updates.length, 0)
  assert.equal(plan.unchanged.length, 1)
})

test('corrected punches update the same imported attendance row', () => {
  const existing = imported()
  const incoming = { ...existing, vao: '08:15', ra: '17:30' }
  delete incoming.id
  const plan = planAttendanceImport({ incomingLogs: [incoming], existingLogs: [existing] })

  assert.equal(plan.inserts.length, 0)
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].id, 'old-id')
})

test('does not overwrite an attendance record from another source', () => {
  const existing = {
    id: 'manual-id', employeeId: 'employee-1', date: '2026-08-01', shiftName: 'Ca ngày', vao: '08:00'
  }
  const incoming = imported({ id: undefined, vao: '08:15' })
  const plan = planAttendanceImport({ incomingLogs: [incoming], existingLogs: [existing] })

  assert.equal(plan.updates.length, 0)
  assert.equal(plan.conflicts.length, 1)
})

test('uses a deterministic id for a new row and collapses duplicate input', () => {
  const incoming = imported({ id: undefined })
  const plan = planAttendanceImport({ incomingLogs: [incoming, { ...incoming }] })

  assert.equal(plan.inserts.length, 1)
  assert.match(plan.inserts[0].id, /^excel_/)
  assert.equal(plan.skipped.length, 1)
})
