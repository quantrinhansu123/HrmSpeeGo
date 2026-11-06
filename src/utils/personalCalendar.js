export const monthCalendarDays = ({ month, logs = [], leaves = [], shifts = [], holidays = [], today }) => {
  const [year, monthNumber] = month.split('-').map(Number)
  const count = new Date(year, monthNumber, 0).getDate()
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
  return Array.from({ length: count }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`
    const dayLogs = logs.filter(log => String(log.date || log.timestamp || '').slice(0, 10) === date)
    const leave = leaves.find(row => row.leave_date === date && row.status !== 'rejected')
    const dayShifts = shifts.filter(row => row.work_date === date && row.status === 'approved')
    const holiday = holidays.find(row => row.date === date)
    const notes = []
    if (holiday) notes.push(holiday.name || 'Ngày lễ')
    if (leave) notes.push(`${leave.status === 'approved' ? 'Nghỉ phép' : 'Nghỉ chờ duyệt'}${leave.reason ? `: ${leave.reason}` : ''}`)
    if (dayShifts.length) notes.push(`Ca: ${[...new Set(dayShifts.map(row => row.shift_name || 'Ca làm'))].join(', ')}`)
    if (dayLogs.length) notes.push(`Đã chấm công${dayLogs[0].cong != null ? ` · ${dayLogs[0].cong} công` : ''}`)
    const status = holiday ? 'holiday' : leave?.status === 'approved' ? 'leave' : dayLogs.length ? 'worked' : dayShifts.length ? 'scheduled' : leave ? 'pending' : date < today ? 'off' : 'empty'
    const labels = { holiday: 'Ngày lễ', leave: 'Nghỉ phép', worked: 'Đã làm', scheduled: 'Có lịch làm', pending: 'Nghỉ chờ duyệt', off: 'Không làm', empty: 'Chưa có lịch' }
    if (status === 'off') notes.push('Không có ca hoặc chấm công')
    return { date, day: index + 1, weekday: (firstWeekday + index) % 7, status, label: labels[status], notes }
  })
}
