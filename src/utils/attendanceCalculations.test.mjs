import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateAttendanceMetrics,
  calculateSplitShiftWork,
  calculateWorkedMinutes,
  describeDayWorkFormula,
  getAttendanceHoliday
} from './attendanceCalculations.js'

test('tính Công từ phút thực tế và tách phần vượt 480 phút', () => {
  const result = calculateAttendanceMetrics({ checkIn: '08:30', checkOut: '15:24' })
  assert.equal(calculateWorkedMinutes({ checkIn: '08:30', checkOut: '15:24' }), 414)
  assert.equal(result.hours, 6.9)
  assert.equal(result.regularWorkdays, 0.8625)
  assert.equal(result.overtimeHours, 0)
})
test('không tạo số âm cho dữ liệu rỗng, cùng giờ hoặc ca đêm', () => {
  assert.equal(calculateWorkedMinutes({}), null)
  assert.equal(calculateWorkedMinutes({ checkIn: '08:00', checkOut: '08:00' }), 0)
  assert.equal(calculateWorkedMinutes({ checkIn: '22:00', checkOut: '06:00' }), 480)
  const overnight = calculateAttendanceMetrics({ checkIn: '22:00', checkOut: '07:00' })
  assert.equal(overnight.regularWorkdays, 1)
  assert.equal(overnight.overtimeHours, 1)
})

test('ưu tiên tăng ca HR nhập và cho phép tắt tự động khi import Excel', () => {
  const manual = calculateAttendanceMetrics({
    log: { tc1: 0.5 },
    checkIn: '08:00',
    checkOut: '18:00'
  })
  assert.equal(manual.overtimeHours, 0.5)

  const excel = calculateAttendanceMetrics({
    log: { overtimeAutoDisabled: true },
    checkIn: '08:00',
    checkOut: '18:00'
  })
  assert.equal(excel.overtimeHours, 0)
})

test('nhận diện ngày lễ đã được cấu hình', () => {
  const holiday = getAttendanceHoliday('2026-09-02', {
    holidays: [{ date: '2026-09-02', name: 'Quốc khánh' }]
  })
  assert.deepEqual(holiday, { date: '2026-09-02', name: 'Quốc khánh' })
  assert.equal(getAttendanceHoliday('2026-09-03', { holidays: [] }), null)
})

const splitShift = {
  enabled: true,
  morning: { start: '08:30', end: '12:00', workdays: 0.5 },
  afternoon: { start: '13:00', end: '17:30', workdays: 0.5 }
}

test('chia hai cặp chấm thành buổi sáng và chiều, không tính giờ nghỉ giữa ca', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '08:30',
    checkOut: '17:30',
    punchPairs: [
      { checkIn: '08:30', checkOut: '12:00' },
      { checkIn: '13:00', checkOut: '17:30' }
    ],
    splitShift,
    autoCalculateOvertime: false
  })

  assert.equal(result.calculationMode, 'split-shift')
  assert.equal(result.hours, 8)
  assert.equal(result.regularWorkdays, 1)
  assert.equal(result.overtimeHours, 0)
})

test('một cặp phủ cả ngày vẫn giữ cách tính full ngày', () => {
  const result = calculateAttendanceMetrics({
    checkIn: '08:30',
    checkOut: '17:30',
    punchPairs: [{ checkIn: '08:30', checkOut: '17:30' }],
    splitShift,
    autoCalculateOvertime: false
  })

  assert.equal(result.calculationMode, 'full-day')
  assert.equal(result.hours, 9)
  assert.equal(result.regularWorkdays, 1)
})

test('một cặp nằm trong buổi sáng được chặn tối đa nửa công', () => {
  const result = calculateSplitShiftWork({
    punchPairs: [{ checkIn: '08:30', checkOut: '12:00' }],
    splitShift
  })

  assert.equal(result.regularWorkdays, 0.5)
  assert.equal(result.workedMinutes, 210)
})

test('mô tả rõ số công riêng của từng buổi trên bảng công', () => {
  const formula = describeDayWorkFormula({
    calculationMode: 'split-shift',
    workdaysExact: 1,
    splitShiftBreakdown: [
      { label: 'Buổi sáng', minutes: 210, workdays: 0.5 },
      { label: 'Buổi chiều', minutes: 270, workdays: 0.5 }
    ]
  })

  assert.match(formula, /Buổi sáng 210p = 0.5 công/)
  assert.match(formula, /Tổng 1 công/)
})
