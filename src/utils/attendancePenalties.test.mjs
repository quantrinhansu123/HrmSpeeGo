import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPenaltyAmountsToSummaryRows,
  createEmptyPenaltyRow,
  getPenaltyTotals,
  mergeAutoPenaltiesWithManual
} from './attendancePenalties.js'

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

test('mergeAutoPenaltiesWithManual giữ dòng tay và thay dòng auto', () => {
  const existing = [
    { id: 'm1', employeeId: 'e1', employeeName: 'A', amount: 200000, source: 'manual', date: '2026-08-01' },
    { id: 'a1', employeeId: 'e1', employeeName: 'A', amount: 50000, source: 'auto', date: '2026-08-02' }
  ]
  const auto = [
    { id: 'a2', employeeId: 'e1', employeeName: 'A', amount: 100000, source: 'auto', date: '2026-08-03' }
  ]
  const merged = mergeAutoPenaltiesWithManual(existing, auto)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].id, 'm1')
  assert.equal(merged[0].source, 'manual')
  assert.equal(merged[1].id, 'a2')
  assert.equal(merged[1].amount, 100000)
})

test('applyPenaltyAmountsToSummaryRows tính tiền phạt từ số lần lỗi', () => {
  const [row] = applyPenaltyAmountsToSummaryRows([{
    employeeName: 'A',
    lateUnder30Count: 2,
    lateOver30Count: 1,
    earlyUnder30Count: 1,
    earlyOver30Count: 0,
    missingPunchCount: 1,
    unapprovedAbsenceCount: 1
  }])
  assert.equal(row.lateFine, 2 * 50000 + 1 * 100000)
  assert.equal(row.earlyFine, 1 * 50000)
  assert.equal(row.missingPunchFine, 50000)
  assert.equal(row.unapprovedAbsenceFine, 200000)
  assert.equal(row.totalFine, row.lateFine + row.earlyFine + row.missingPunchFine + row.unapprovedAbsenceFine)
})
