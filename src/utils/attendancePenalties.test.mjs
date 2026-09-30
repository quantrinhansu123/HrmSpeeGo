import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyPenaltyRow, getPenaltyTotals } from './attendancePenalties.js'

test('penalty totals exclude a new row until an employee is selected', () => {
  const draft = createEmptyPenaltyRow('2026-08')
  assert.deepEqual(getPenaltyTotals([draft]), { errorCount: 0, amount: 0 })

  const assigned = { ...draft, employeeId: 'employee-1' }
  assert.deepEqual(getPenaltyTotals([assigned]), { errorCount: 1, amount: 50000 })
})

test('penalty totals count zero-amount errors and ignore invalid amounts', () => {
  const rows = [
    { employeeName: 'Nhân viên A', amount: 0 },
    { employeeCode: 'NV002', amount: 75000 },
    { employeeId: 'employee-3', amount: 'bad value' }
  ]
  assert.deepEqual(getPenaltyTotals(rows), { errorCount: 3, amount: 75000 })
})
