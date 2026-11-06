import test from 'node:test'
import assert from 'node:assert/strict'
import { monthCalendarDays } from './personalCalendar.js'

test('lịch tháng phân biệt ngày làm, nghỉ, lễ và ngày chưa có lịch', () => {
  const days = monthCalendarDays({
    month: '2026-11', today: '2026-11-06',
    logs: [{ date: '2026-11-02', cong: 1 }, { date: '2026-11-04', cong: 1 }],
    leaves: [{ leave_date: '2026-11-03', status: 'approved', reason: 'Phép năm' }],
    shifts: [{ work_date: '2026-11-07', status: 'approved', shift_name: 'Ca sáng' }],
    holidays: [{ date: '2026-11-04', name: 'Ngày lễ thử' }]
  })
  assert.equal(days.length, 30)
  assert.equal(days[0].weekday, 6)
  assert.equal(days[1].status, 'worked')
  assert.equal(days[2].status, 'leave')
  assert.deepEqual(days[2].notes, ['Nghỉ phép: Phép năm'])
  assert.equal(days[3].status, 'holiday')
  assert.match(days[3].notes.join(' '), /Đã chấm công/)
  assert.equal(days[4].status, 'off')
  assert.equal(days[6].status, 'scheduled')
  assert.equal(days[7].status, 'empty')
})
