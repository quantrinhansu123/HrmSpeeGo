import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { addLeaveDay, loadLeaveDays } from '../services/leaveDays'
import { getCompanyIdForUser } from '../utils/companyContext'
import { formatLeaveDate, todayLocalDate } from '../utils/leaveDays'
import './LeaveDays.css'

function LeaveDays() {
  const { user } = useAuth()
  const companyId = user?.company_id || user?.companyId || getCompanyIdForUser(user)
  const canViewAll = user?.role === 'admin' || user?.role === 'hr'
  const name = String(user?.ho_va_ten || '').trim()
  const [records, setRecords] = useState([])
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [leaveDate, setLeaveDate] = useState(() => todayLocalDate())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await loadLeaveDays({ companyId, employeeId: canViewAll ? null : user.id })
      setRecords(rows)
    } catch (requestError) {
      setError(requestError.message || 'Không tải được ngày nghỉ phép.')
    } finally {
      setLoading(false)
    }
  }, [companyId, canViewAll, user.id])

  useEffect(() => { reload() }, [reload])

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    return query
      ? records.filter(row => row.employee_name.toLocaleLowerCase('vi').includes(query))
      : records
  }, [records, search])

  const save = async event => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!name) {
      setError('Hồ sơ tài khoản chưa có họ tên. Vui lòng liên hệ HR để cập nhật.')
      return
    }
    setSaving(true)
    try {
      const record = await addLeaveDay({ companyId, employeeId: user.id, leaveDate })
      setRecords(current => [record, ...current].sort((a, b) =>
        b.leave_date.localeCompare(a.leave_date) || a.id.localeCompare(b.id)))
      setSearch('')
      setFormOpen(false)
      setLeaveDate(todayLocalDate())
      setNotice('Đã ghi nhận ngày nghỉ phép.')
    } catch (requestError) {
      setError(requestError.message || 'Không ghi nhận được ngày nghỉ phép.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="leave-days-page">
    <header className="leave-days-header">
      <div>
        <h1>Ngày nghỉ phép</h1>
        <p>{canViewAll ? 'Danh sách ngày nghỉ của nhân sự trong công ty.' : 'Danh sách ngày nghỉ phép của bạn.'}</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={() => {
        setFormOpen(current => !current)
        setError('')
        setNotice('')
      }} aria-expanded={formOpen}>
        <i className={`fas fa-${formOpen ? 'times' : 'plus'}`} aria-hidden="true" /> {formOpen ? 'Đóng' : 'Thêm mới'}
      </button>
    </header>

    {formOpen && <form className="leave-days-form" onSubmit={save}>
      <h2>Thêm ngày nghỉ phép</h2>
      <div className="leave-days-form-grid">
        <label>Tên người nghỉ
          <input type="text" value={name} readOnly aria-readonly="true" placeholder="Chưa có họ tên trong hồ sơ" />
          {!name && <small>Hồ sơ tài khoản cần có họ tên trước khi ghi nhận ngày nghỉ.</small>}
        </label>
        <label>Ngày nghỉ phép
          <input type="date" value={leaveDate} onChange={event => setLeaveDate(event.target.value)} required />
        </label>
      </div>
      <div className="leave-days-form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || !name}>{saving ? 'Đang lưu...' : 'Lưu ngày nghỉ'}</button>
      </div>
    </form>}

    {error && <div className="leave-days-message is-error" role="alert">{error}</div>}
    {notice && <div className="leave-days-message is-success" role="status">{notice}</div>}

    <section className="leave-days-list">
      <div className="leave-days-list-head">
        <h2>Danh sách ngày nghỉ</h2>
        <div className="leave-days-list-tools">
          {canViewAll && <label>Tìm nhân sự
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nhập tên nhân sự" />
          </label>}
          <button type="button" className="btn" onClick={reload} disabled={loading}>Tải lại</button>
        </div>
      </div>
      {loading ? <p className="leave-days-empty">Đang tải danh sách...</p> : error && records.length === 0 ? null : visibleRecords.length === 0 ? (
        <p className="leave-days-empty">Chưa có ngày nghỉ phép nào.</p>
      ) : <div className="leave-days-table-wrap">
        <table>
          <thead><tr><th scope="col">Tên người nghỉ</th><th scope="col">Ngày nghỉ phép</th></tr></thead>
          <tbody>{visibleRecords.map(record => <tr key={record.id}>
            <td>{record.employee_name}</td>
            <td>{formatLeaveDate(record.leave_date)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </div>
}

export default LeaveDays
