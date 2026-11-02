import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fbGet } from '../services/firebase'
import { decideShiftRegistrations, loadShiftRegistrations, saveShiftRegistrations } from '../services/shiftRegistrations'
import { getCompanyIdForUser } from '../utils/companyContext'
import { normalizeAttendanceShiftSettings } from '../utils/attendanceShift'
import {
  buildRegistrationChanges,
  buildShiftOptions,
  describeShift,
  formatShortDate,
  formatWeekRange,
  SHIFT_STATUS_LABELS,
  shiftWeekKey,
  toDateKey,
  weekDays,
  weekStartKey
} from '../utils/shiftRegistration'
import './ShiftRegistration.css'

function ShiftRegistration() {
  const { user } = useAuth()
  const companyId = user?.company_id || user?.companyId || getCompanyIdForUser(user)
  const canApprove = user?.role === 'admin' || user?.role === 'hr'
  const [weekStart, setWeekStart] = useState(() => weekStartKey(toDateKey(new Date())))
  const [options, setOptions] = useState(() => buildShiftOptions(normalizeAttendanceShiftSettings()))
  const [records, setRecords] = useState([])
  const [selections, setSelections] = useState({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const days = useMemo(() => weekDays(weekStart), [weekStart])

  useEffect(() => {
    fbGet('hr/attendanceSettings/default')
      .then(settings => setOptions(buildShiftOptions(normalizeAttendanceShiftSettings(settings))))
      .catch(() => {})
  }, [])

  const reload = useCallback(async () => {
    if (days.length === 0) return
    setLoading(true)
    setError('')
    try {
      const rows = await loadShiftRegistrations({
        companyId,
        employeeId: canApprove ? null : user.id,
        from: days[0].date,
        to: days[6].date
      })
      setRecords(rows)
      setSelectedIds(new Set())
    } catch (requestError) {
      setError(requestError.message || 'Không tải được đăng ký ca.')
    } finally {
      setLoading(false)
    }
  }, [companyId, canApprove, days, user.id])

  useEffect(() => { reload() }, [reload])

  const myByDate = useMemo(() => {
    const map = {}
    records.filter(record => record.employee_id === user.id).forEach(record => { map[record.work_date] = record })
    return map
  }, [records, user.id])

  // Ô chọn ca mặc định theo dữ liệu đã đăng ký; người dùng chỉnh thì ghi đè.
  useEffect(() => {
    const next = {}
    days.forEach(({ date }) => { next[date] = myByDate[date]?.shift_id || '' })
    setSelections(next)
  }, [days, myByDate])

  const changes = useMemo(
    () => buildRegistrationChanges({ days, selections, existingByDate: myByDate, options }),
    [days, selections, myByDate, options]
  )
  const hasChanges = changes.upserts.length > 0 || changes.removals.length > 0

  const changeWeek = weeks => {
    setWeekStart(current => shiftWeekKey(current, weeks))
    setNotice('')
  }

  const save = async event => {
    event.preventDefault()
    setError('')
    setNotice('')
    setSaving(true)
    try {
      await saveShiftRegistrations({ companyId, employeeId: user.id, ...changes })
      setNotice('Đã gửi đăng ký ca. Trạng thái: Chờ duyệt.')
      await reload()
    } catch (requestError) {
      setError(requestError.message || 'Không lưu được đăng ký ca.')
    } finally {
      setSaving(false)
    }
  }

  const decide = async (ids, status) => {
    if (!ids.length || deciding) return
    setError('')
    setNotice('')
    setDeciding(true)
    try {
      const updated = await decideShiftRegistrations({ companyId, ids, status })
      const byId = new Map(updated.map(row => [row.id, row]))
      setRecords(current => current.map(row => byId.get(row.id) || row))
      setSelectedIds(new Set())
      setNotice(`${status === 'approved' ? 'Đã duyệt' : 'Đã từ chối'} ${updated.length} ca.`)
    } catch (requestError) {
      setError(requestError.message || 'Không xử lý được đăng ký ca.')
    } finally {
      setDeciding(false)
    }
  }

  const employeeRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    const grouped = new Map()
    records.forEach(record => {
      if (query && !record.employee_name.toLocaleLowerCase('vi').includes(query)) return
      if (!grouped.has(record.employee_id)) grouped.set(record.employee_id, { name: record.employee_name, byDate: {} })
      grouped.get(record.employee_id).byDate[record.work_date] = record
    })
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [records, search])

  const pendingIds = useMemo(
    () => employeeRows.flatMap(row => Object.values(row.byDate)).filter(record => record.status === 'pending').map(record => record.id),
    [employeeRows]
  )
  const selectedPending = pendingIds.filter(id => selectedIds.has(id))

  const toggleId = id => setSelectedIds(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <div className="shift-reg-page">
    <header className="shift-reg-header">
      <div>
        <h1>Đăng ký ca làm việc</h1>
        <p>Chọn ca cho từng ngày trong tuần, gửi để HR duyệt.</p>
      </div>
      <div className="shift-reg-week" role="group" aria-label="Chọn tuần">
        <button type="button" className="btn" onClick={() => changeWeek(-1)} aria-label="Tuần trước"><i className="fas fa-chevron-left" aria-hidden="true" /></button>
        <strong>{formatWeekRange(weekStart)}</strong>
        <button type="button" className="btn" onClick={() => changeWeek(1)} aria-label="Tuần sau"><i className="fas fa-chevron-right" aria-hidden="true" /></button>
        <button type="button" className="btn" onClick={() => setWeekStart(weekStartKey(toDateKey(new Date())))}>Tuần này</button>
      </div>
    </header>

    {error && <div className="shift-reg-message is-error" role="alert">{error}</div>}
    {notice && <div className="shift-reg-message is-success" role="status">{notice}</div>}

    <form className="shift-reg-card" onSubmit={save}>
      <h2>Ca của tôi</h2>
      <div className="shift-reg-table-wrap">
        <table>
          <thead><tr><th scope="col">Ngày</th><th scope="col">Ca đăng ký</th><th scope="col">Trạng thái</th></tr></thead>
          <tbody>{days.map(day => {
            const existing = myByDate[day.date]
            const locked = existing?.status === 'approved'
            return <tr key={day.date}>
              <td data-label="Ngày">{day.label} · {formatShortDate(day.date)}</td>
              <td data-label="Ca đăng ký">
                <select
                  value={selections[day.date] || ''}
                  disabled={locked || loading}
                  onChange={event => setSelections(current => ({ ...current, [day.date]: event.target.value }))}
                  aria-label={`Ca ngày ${day.label} ${formatShortDate(day.date)}`}
                >
                  <option value="">— Chưa đăng ký —</option>
                  {options.map(option => <option key={option.id} value={option.id}>{describeShift(option)}</option>)}
                </select>
              </td>
              <td data-label="Trạng thái">{existing
                ? <span className={`shift-reg-status is-${existing.status}`}>{SHIFT_STATUS_LABELS[existing.status]}</span>
                : '—'}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <div className="shift-reg-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || loading || !hasChanges}>
          {saving ? 'Đang gửi...' : 'Gửi đăng ký'}
        </button>
      </div>
    </form>

    {canApprove && <section className="shift-reg-card">
      <div className="shift-reg-list-head">
        <h2>Đăng ký ca của nhân sự</h2>
        <div className="shift-reg-tools">
          <label>Tìm nhân sự
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên nhân sự" />
          </label>
          <button type="button" className="btn btn-primary" disabled={deciding || selectedPending.length === 0} onClick={() => decide(selectedPending, 'approved')}>
            Duyệt đã chọn ({selectedPending.length})
          </button>
          <button type="button" className="btn btn-danger" disabled={deciding || selectedPending.length === 0} onClick={() => decide(selectedPending, 'rejected')}>
            Từ chối
          </button>
          <button type="button" className="btn" disabled={deciding || pendingIds.length === 0} onClick={() => decide(pendingIds, 'approved')}>
            Duyệt tất cả ({pendingIds.length})
          </button>
        </div>
      </div>
      {loading ? <p className="shift-reg-empty">Đang tải...</p> : employeeRows.length === 0 ? (
        <p className="shift-reg-empty">Chưa có đăng ký ca nào trong tuần này.</p>
      ) : <div className="shift-reg-table-wrap">
        <table className="shift-reg-board">
          <thead><tr>
            <th scope="col">Nhân sự</th>
            {days.map(day => <th key={day.date} scope="col">{day.label}<small>{formatShortDate(day.date)}</small></th>)}
          </tr></thead>
          <tbody>{employeeRows.map(row => <tr key={row.name}>
            <th scope="row">{row.name}</th>
            {days.map(day => {
              const record = row.byDate[day.date]
              return <td key={day.date} data-label={`${day.label} ${formatShortDate(day.date)}`}>{record ? <div className="shift-reg-cell">
                {record.status === 'pending' && <input
                  type="checkbox"
                  checked={selectedIds.has(record.id)}
                  onChange={() => toggleId(record.id)}
                  aria-label={`Chọn ca ${row.name} ${day.label}`}
                />}
                <span>{record.shift_name}</span>
                <span className={`shift-reg-status is-${record.status}`}>{SHIFT_STATUS_LABELS[record.status]}</span>
              </div> : '—'}</td>
            })}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>}
  </div>
}

export default ShiftRegistration
