import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAttendanceRecordKey,
  buildAttendanceStorageId,
  matchAttendanceEmployee
} from './attendanceMatching.js'

test('does not auto-match a machine code collision when employee names differ', () => {
  const wrongEmployee = {
    id: 'wrong-profile',
    employeeId: '00019',
    ho_va_ten: 'Nguyễn Thị Hồng Thắm'
  }

  const match = matchAttendanceEmployee(
    '00019',
    'Nguyễn Thị Phương Anh',
    [wrongEmployee]
  )

  assert.equal(match.employee, null)
  assert.ok(match.confidence < 0.9)
  assert.equal(match.method, 'Mã trùng nhưng tên không khớp')
})

test('prefers an exact name over a colliding machine code', () => {
  const wrongEmployee = {
    id: 'wrong-profile',
    employeeId: '00019',
    ho_va_ten: 'Nguyễn Thị Hồng Thắm'
  }
  const correctEmployee = {
    id: 'correct-profile',
    employeeId: 'LU099',
    ho_va_ten: 'Nguyễn Thị Phương Anh'
  }

  const match = matchAttendanceEmployee(
    '00019',
    'Nguyễn Thị Phương Anh',
    [wrongEmployee, correctEmployee]
  )

  assert.equal(match.employee?.id, 'correct-profile')
  assert.equal(match.method, 'Tên trùng → gán mã nhân viên Lumi')
})

test('still auto-matches when both employee code and name agree', () => {
  const employee = {
    id: 'correct-profile',
    employeeId: 'LU035',
    ho_va_ten: 'Đặng Thùy Liên'
  }

  const match = matchAttendanceEmployee('LU035', 'Đặng Thùy Liên', [employee])

  assert.equal(match.employee?.id, 'correct-profile')
  assert.equal(match.status, 'matched')
})

test('does not auto-match different Vietnamese given names with a high overall similarity', () => {
  const employee = {
    id: 'wrong-profile',
    employeeId: 'LU003',
    ho_va_ten: 'Nguyễn Thị Gấm'
  }

  const match = matchAttendanceEmployee('00012', 'Nguyễn Thị Đảm', [employee])

  assert.equal(match.employee, null)
  assert.equal(match.status, 'review')
})

test('does not choose arbitrarily when multiple profiles have the same full name', () => {
  const employees = [
    { id: 'profile-1', employeeId: 'LU012', ho_va_ten: 'Nguyễn Thị Lan Anh' },
    { id: 'profile-2', employeeId: 'LU018', ho_va_ten: 'Nguyễn Thị Lan Anh' }
  ]

  const match = matchAttendanceEmployee('00004', 'Nguyễn Thị Lan Anh', employees)

  assert.equal(match.employee, null)
  assert.equal(match.status, 'review')
})

test('matches an exact name even when its profile is outside the preferred branch', () => {
  const employees = [
    {
      id: 'profile-hn',
      employeeId: 'LU101',
      ho_va_ten: 'Nguyễn Việt Khánh',
      chi_nhanh: 'Hà Nội'
    },
    {
      id: 'profile-hcm',
      employeeId: 'LU102',
      ho_va_ten: 'Nguyễn Nam Khánh',
      chi_nhanh: 'HCM'
    }
  ]

  const match = matchAttendanceEmployee(
    'ROW11',
    'Nguyễn Việt Khánh',
    employees,
    'HCM'
  )

  assert.equal(match.employee?.id, 'profile-hn')
  assert.equal(match.confidence, 1)
})

test('uses the preferred branch to resolve duplicate exact names', () => {
  const employees = [
    {
      id: 'profile-hn',
      employeeId: 'LU201',
      ho_va_ten: 'Nguyễn Thị Lan Anh',
      chi_nhanh: 'Hà Nội'
    },
    {
      id: 'profile-hcm',
      employeeId: 'LU202',
      ho_va_ten: 'Nguyễn Thị Lan Anh',
      chi_nhanh: 'HCM'
    }
  ]

  const match = matchAttendanceEmployee(
    'ROW23',
    'Nguyễn Thị Lan Anh',
    employees,
    'HCM'
  )

  assert.equal(match.employee?.id, 'profile-hcm')
  assert.equal(match.status, 'matched')
})

test('attendance identity stays stable when corrected punch times change', () => {
  const first = {
    employeeId: 'user-1', date: '2026-08-01', vao: '08:00', ra: '17:00', shiftName: 'Ca ngày'
  }
  const corrected = { ...first, vao: '08:15', ra: '17:30' }

  assert.equal(buildAttendanceRecordKey(first), buildAttendanceRecordKey(corrected))
  assert.equal(buildAttendanceStorageId(first), buildAttendanceStorageId(corrected))
})

test('attendance identity keeps different employees and shifts separate', () => {
  const base = { employeeId: 'user-1', date: '2026-08-01', shiftName: 'Ca ngày' }
  assert.notEqual(buildAttendanceRecordKey(base), buildAttendanceRecordKey({ ...base, employeeId: 'user-2' }))
  assert.notEqual(buildAttendanceRecordKey(base), buildAttendanceRecordKey({ ...base, shiftName: 'Ca đêm' }))
})
