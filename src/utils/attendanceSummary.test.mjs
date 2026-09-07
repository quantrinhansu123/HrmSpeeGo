import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAttendanceSummary } from './attendanceSummary.js'

test('keeps an unmatched source employee in the monthly attendance summary', () => {
  const rows = buildAttendanceSummary({
    attendanceLogs: [{
      employeeId: 'external:00002::nguyenbuikhanhvan',
      employeeCode: '00002',
      employeeName: 'Nguyễn Bùi Khánh Vân',
      sourceEmployeeCode: '00002',
      sourceEmployeeName: 'Nguyễn Bùi Khánh Vân',
      department: 'Văn phòng',
      date: '2026-08-01',
      cong: 0.9,
      congPlus: 0,
      hours: 7.2,
      vao: '08:20',
      ra: '17:30'
    }],
    employees: [],
    month: '2026-08'
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].employeeCode, '00002')
  assert.equal(rows[0].employeeName, 'Nguyễn Bùi Khánh Vân')
  assert.equal(rows[0].department, 'Văn phòng')
  assert.equal(rows[0].workdays, 0.9)
  assert.equal(rows[0].days.get('2026-08-01').hours, 7.2)
})

test('recalculates the late report from actual punches and each employee shift', () => {
  const employees = [
    { id: 'normal', name: 'Nhân viên thường', position: 'HR', shift: 'Ca ngày' },
    { id: 'sale', name: 'Nhân viên Sale', position: 'Sale', shift: 'Ca ngày' }
  ]
  const rows = buildAttendanceSummary({
    attendanceLogs: [
      {
        employeeId: 'normal',
        date: '2026-08-06',
        vao: '08:35',
        ra: '17:36',
        lateMinutes: 65,
        earlyMinutes: 0,
        cong: 1,
        hours: 8
      },
      {
        employeeId: 'sale',
        date: '2026-08-05',
        vao: '04:02',
        ra: '13:38',
        lateMinutes: 0,
        earlyMinutes: 202,
        cong: 1,
        hours: 8
      }
    ],
    employees,
    month: '2026-08'
  })

  const normal = rows.find(row => row.employeeId === 'normal')
  const sale = rows.find(row => row.employeeId === 'sale')
  assert.equal(normal.lateMinutes, 5)
  assert.equal(normal.earlyMinutes, 0)
  assert.equal(normal.lateCount, 1)
  assert.equal(sale.lateMinutes, 2)
  assert.equal(sale.earlyMinutes, 0)
  assert.equal(sale.lateCount, 1)
})

test('uses configured times for the employee shift in summary reports', () => {
  const employees = [
    { id: 'normal', name: 'Hành chính', position: 'HR', shift: 'Ca Hành chính' },
    { id: 'sale', name: 'Sale', position: 'Sale', shift: 'Ca Sáng Sale' }
  ]
  const attendanceLogs = [
    { employeeId: 'normal', date: '2026-08-01', vao: '08:40', ra: '17:35', cong: 1 },
    { employeeId: 'sale', date: '2026-08-01', vao: '04:10', ra: '13:25', cong: 1 }
  ]
  const attendanceSettings = {
    shifts: {
      administrative: { standardCheckIn: '08:35', standardCheckOut: '17:40' },
      saleMorning: { standardCheckIn: '04:05', standardCheckOut: '13:35' }
    }
  }

  const rows = buildAttendanceSummary({
    attendanceLogs,
    employees,
    month: '2026-08',
    attendanceSettings
  })
  const normal = rows.find(row => row.employeeId === 'normal')
  const sale = rows.find(row => row.employeeId === 'sale')

  assert.equal(normal.lateMinutes, 5)
  assert.equal(normal.earlyMinutes, 5)
  assert.equal(sale.lateMinutes, 5)
  assert.equal(sale.earlyMinutes, 10)
})
