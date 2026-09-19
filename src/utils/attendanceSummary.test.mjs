import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAttendanceSummary } from './attendanceSummary.js'

test('keeps an unmatched source employee and recalculates punches by actual minutes', () => {
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
  // 08:20 → 17:30 = 550 phút; Công được chặn tối đa 1 ngày.
  assert.equal(rows[0].workdays, 1)
  assert.equal(rows[0].days.get('2026-08-01').hours, 9.17)
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

test('hiển thị ngày lễ cho nhân viên không có log nhưng không tự cộng công', () => {
  const rows = buildAttendanceSummary({
    attendanceLogs: [],
    employees: [{ id: 'employee-holiday', name: 'Nhân viên ngày lễ' }],
    month: '2026-09',
    attendanceSettings: {
      holidays: [{ date: '2026-09-02', name: 'Quốc khánh' }]
    }
  })

  const row = rows[0]
  const holiday = row.days.get('2026-09-02')
  assert.equal(holiday.isHoliday, true)
  assert.equal(holiday.holidayName, 'Quốc khánh')
  assert.equal(holiday.hours, 0)
  assert.equal(holiday.workdays, 0)
  assert.equal(row.attendanceDays, 0)
  assert.equal(row.workdays, 0)
})

test('tách công thực tế, phép hưởng lương và tổng công tính lương', () => {
  const rows = buildAttendanceSummary({
    attendanceLogs: [
      {
        employeeId: 'employee-breakdown',
        date: '2026-08-03',
        cong: 0.88,
        hours: 7.02
      },
      {
        employeeId: 'employee-breakdown',
        date: '2026-08-04',
        cong: 0,
        congPlus: 1,
        kyHieuPlus: 'V'
      }
    ],
    employees: [{ id: 'employee-breakdown', name: 'Nhân viên tách công' }],
    month: '2026-08'
  })

  assert.equal(rows[0].actualWorkdays, 0.88)
  assert.equal(rows[0].paidLeaveWorkdays, 1)
  assert.equal(rows[0].workdays, 1.88)
})

test('tự dùng hai buổi khi có hai cặp chấm và giữ full ngày khi chỉ có một cặp', () => {
  const attendanceSettings = {
    shifts: {
      administrative: {
        name: 'Ca Hành chính',
        standardCheckIn: '08:30',
        standardCheckOut: '17:30',
        splitShift: {
          enabled: true,
          morning: { start: '08:30', end: '12:00', workdays: 0.5 },
          afternoon: { start: '13:00', end: '17:30', workdays: 0.5 }
        }
      },
      saleMorning: {
        name: 'Ca Sáng Sale',
        standardCheckIn: '04:00',
        standardCheckOut: '13:30',
        splitShift: {
          enabled: true,
          morning: { start: '04:00', end: '08:00', workdays: 0.5 },
          afternoon: { start: '09:30', end: '13:30', workdays: 0.5 }
        }
      }
    }
  }
  const rows = buildAttendanceSummary({
    attendanceLogs: [
      {
        employeeId: 'split-worker',
        date: '2026-08-03',
        vao: '08:30',
        ra: '17:30',
        punchPairs: [
          { checkIn: '08:30', checkOut: '12:00' },
          { checkIn: '13:00', checkOut: '17:30' }
        ]
      },
      {
        employeeId: 'full-worker',
        date: '2026-08-03',
        vao: '08:30',
        ra: '17:30',
        punchPairs: [{ checkIn: '08:30', checkOut: '17:30' }]
      },
      {
        employeeId: 'sale-split-worker',
        date: '2026-08-03',
        vao: '04:00',
        ra: '13:30',
        punchPairs: [
          { checkIn: '04:00', checkOut: '08:00' },
          { checkIn: '09:30', checkOut: '13:30' }
        ]
      }
    ],
    employees: [
      { id: 'split-worker', name: 'Nhân viên chia buổi', shift: 'Ca Hành chính' },
      { id: 'full-worker', name: 'Nhân viên full ngày', shift: 'Ca Hành chính' },
      { id: 'sale-split-worker', name: 'Sale chia buổi', shift: 'Ca Sáng Sale', position: 'Sale' }
    ],
    month: '2026-08',
    attendanceSettings
  })

  const splitDay = rows.find(row => row.employeeId === 'split-worker').days.get('2026-08-03')
  const fullDay = rows.find(row => row.employeeId === 'full-worker').days.get('2026-08-03')
  const saleSplitDay = rows.find(row => row.employeeId === 'sale-split-worker').days.get('2026-08-03')
  assert.equal(splitDay.calculationMode, 'split-shift')
  assert.equal(splitDay.hours, 8)
  assert.equal(splitDay.workdays, 1)
  assert.equal(fullDay.calculationMode, 'full-day')
  assert.equal(fullDay.hours, 9)
  assert.equal(fullDay.workdays, 1)
  assert.equal(saleSplitDay.calculationMode, 'split-shift')
  assert.equal(saleSplitDay.hours, 8)
  assert.equal(saleSplitDay.workdays, 1)
})
