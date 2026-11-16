import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LeaveDayDetails from '../components/LeaveDayDetails'
import { useAuth } from '../contexts/AuthContext'
import { loadLeaveEmployees } from '../services/employeeLeave'
import { addLeaveDay, approveLeaveDay, deleteLeaveDays, loadLeaveDays } from '../services/leaveDays'
import { getCompanyIdForUser } from '../utils/companyContext'
import { formatLeaveDate, LEAVE_REASON_OPTIONS, todayLocalDate } from '../utils/leaveDays'
import './LeaveDays.css'

const UNASSIGNED_DEPARTMENT = 'Chưa có phòng ban'

function LeaveDays() {
  const { user } = useAuth()
  const companyId = user?.company_id || user?.companyId || getCompanyIdForUser(user)
  const canViewAll = user?.role === 'admin' || user?.role === 'hr'
  const name = String(user?.ho_va_ten || '').trim()
  const [records, setRecords] = useState([])
  const [departmentsByEmployee, setDepartmentsByEmployee] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [leaveDate, setLeaveDate] = useState(() => todayLocalDate())
  const [reason, setReason] = useState(LEAVE_REASON_OPTIONS[0])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [approvingId, setApprovingId] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await loadLeaveDays({ companyId, employeeId: canViewAll ? null : user.id })
      let people = []
      if (canViewAll) {
        try {
          people = await loadLeaveEmployees(companyId)
        } catch (directoryError) {
          console.error('Không tải được phòng ban nhân sự:', directoryError)
        }
      }
      const departments = {}
      people.forEach(person => {
        departments[person.id] = String(person.bo_phan || '').trim()
      })
      if (user?.id) departments[user.id] = String(user.bo_phan || user.department || departments[user.id] || '').trim()
      setDepartmentsByEmployee(departments)
      setRecords(rows)
    } catch (requestError) {
      setError(requestError.message || 'Không tải được ngày nghỉ phép.')
    } finally {
      setLoading(false)
    }
  }, [companyId, canViewAll, user.id, user.bo_phan, user.department])

  useEffect(() => { reload() }, [reload])

  const departmentGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    const grouped = new Map()
    records.forEach(record => {
      if (statusFilter && record.status !== statusFilter) return
      const department = String(departmentsByEmployee[record.employee_id] || '').trim()
      const label = department || UNASSIGNED_DEPARTMENT
      if (query && !`${record.employee_name} ${label}`.toLocaleLowerCase('vi').includes(query)) return
      if (!grouped.has(label)) grouped.set(label, [])
      grouped.get(label).push(record)
    })
    return [...grouped.entries()]
      .sort((a, b) => {
        if (a[0] === UNASSIGNED_DEPARTMENT) return 1
        if (b[0] === UNASSIGNED_DEPARTMENT) return -1
        return a[0].localeCompare(b[0], 'vi')
      })
      .map(([name, items]) => ({ name, items }))
  }, [records, search, departmentsByEmployee, statusFilter])

  const visibleIds = useMemo(
    () => departmentGroups.flatMap(group => group.items.map(record => record.id)),
    [departmentGroups]
  )
  const selectedVisibleCount = visibleIds.filter(id => selectedIds.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length

  const toggleRecord = id => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleIds = (ids, checked) => {
    setSelectedIds(current => {
      const next = new Set(current)
      ids.forEach(id => {
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  const removeSelected = async () => {
    const ids = visibleIds.filter(id => selectedIds.has(id))
    if (!ids.length || deleting) return
    if (!window.confirm(`Xóa ${ids.length} ngày nghỉ phép đã chọn?`)) return
    setDeleting(true)
    setError('')
    setNotice('')
    try {
      const removed = await deleteLeaveDays({ ids })
      const removedIds = new Set(removed)
      setRecords(current => current.filter(record => !removedIds.has(record.id)))
      setSelectedIds(current => {
        const next = new Set(current)
        removed.forEach(id => next.delete(id))
        return next
      })
      setNotice(`Đã xóa ${removed.length} ngày nghỉ phép.`)
    } catch (requestError) {
      setError(requestError.message || 'Không xóa được ngày nghỉ phép đã chọn.')
    } finally {
      setDeleting(false)
    }
  }

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
      const record = await addLeaveDay({ companyId, employeeId: user.id, leaveDate, reason })
      setRecords(current => [record, ...current].sort((a, b) =>
        b.leave_date.localeCompare(a.leave_date) || a.id.localeCompare(b.id)))
      setSearch('')
      setFormOpen(false)
      setLeaveDate(todayLocalDate())
      setReason(LEAVE_REASON_OPTIONS[0])
      setNotice('Đã gửi yêu cầu nghỉ phép. Trạng thái: Chờ duyệt.')
    } catch (requestError) {
      setError(requestError.message || 'Không ghi nhận được ngày nghỉ phép.')
    } finally {
      setSaving(false)
    }
  }

  const approve = async record => {
    setError('')
    setNotice('')
    setApprovingId(record.id)
    try {
      const approved = await approveLeaveDay({ companyId, leaveDayId: record.id })
      setRecords(current => current.map(row => row.id === approved.id ? approved : row))
      setNotice(`Đã duyệt ngày nghỉ phép của ${record.employee_name}.`)
    } catch (requestError) {
      setError(requestError.message || 'Không duyệt được ngày nghỉ phép.')
    } finally {
      setApprovingId('')
    }
  }

  return <div className="leave-days-page">
    <header className="leave-days-header">
      <div>
        <h1>Ngày nghỉ phép</h1>
        <p>{canViewAll ? 'Danh sách ngày nghỉ theo phòng ban, liên kết với đề xuất nghỉ phép đã duyệt.' : 'Ngày nghỉ của bạn, đề xuất liên quan và lịch sử điều chỉnh.'}</p>
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
      <label className="leave-days-reason">Lý do nghỉ phép
        <select value={reason} onChange={event => setReason(event.target.value)} required>
          {LEAVE_REASON_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
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
          <label>Trạng thái<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="">Tất cả</option><option value="approved">Đã duyệt</option><option value="pending">Chờ duyệt</option>
          </select></label>
          {canViewAll && <label>Tìm nhân sự
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên hoặc phòng ban" />
          </label>}
          {visibleIds.length > 0 && <label className="leave-days-select-all">
            <input
              className="leave-days-check"
              type="checkbox"
              checked={allVisibleSelected}
              onChange={event => toggleIds(visibleIds, event.target.checked)}
            />
            Chọn tất cả
          </label>}
          <button type="button" className="btn btn-danger" onClick={removeSelected} disabled={deleting || selectedVisibleCount === 0}>
            {deleting ? 'Đang xóa...' : `Xóa đã chọn (${selectedVisibleCount})`}
          </button>
          <button type="button" className="btn" onClick={reload} disabled={loading}>Tải lại</button>
        </div>
      </div>
      {loading ? <p className="leave-days-empty">Đang tải danh sách...</p> : error && records.length === 0 ? null : departmentGroups.length === 0 ? (
        <p className="leave-days-empty">Chưa có ngày nghỉ phép nào.</p>
      ) : <div className="leave-days-groups">
        {departmentGroups.map(group => <section key={group.name} className="leave-days-group">
          <div className="leave-days-group-head">
            <h3>{group.name}</h3>
            <span>{group.items.length} ngày</span>
          </div>
          <div className="leave-days-table-wrap">
            <table>
              <thead><tr>
                <th className="leave-days-check-col" scope="col">
                  <input
                    className="leave-days-check"
                    type="checkbox"
                    checked={group.items.length > 0 && group.items.every(record => selectedIds.has(record.id))}
                    onChange={event => toggleIds(group.items.map(record => record.id), event.target.checked)}
                    aria-label={`Chọn tất cả ngày nghỉ của ${group.name}`}
                  />
                </th>
                <th scope="col">Tên người nghỉ</th><th scope="col">Ngày nghỉ phép</th><th scope="col">Lý do</th><th scope="col">Trạng thái</th><th scope="col">Đề xuất liên quan</th><th scope="col">Điều chỉnh</th><th scope="col">Thao tác</th>
              </tr></thead>
              <tbody>{group.items.map(record => <tr key={record.id}>
                <td className="leave-days-check-col" data-label="Chọn">
                  <input
                    className="leave-days-check"
                    type="checkbox"
                    checked={selectedIds.has(record.id)}
                    onChange={() => toggleRecord(record.id)}
                    aria-label={`Chọn ngày nghỉ của ${record.employee_name}`}
                  />
                </td>
                <td data-label="Tên người nghỉ">{record.employee_name}</td>
                <td data-label="Ngày nghỉ phép">{formatLeaveDate(record.leave_date)}</td>
                <td data-label="Lý do">{record.reason || '—'}</td>
                <td data-label="Trạng thái"><span className={`leave-days-status is-${record.status || 'pending'}`}>{record.status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}</span></td>
                <td data-label="Đề xuất liên quan">{record.approval_request_id
                  ? <Link to={`/approvals?view=detail&id=${encodeURIComponent(record.approval_snapshot?.id || record.approval_request_id.replace(/^approvalRequests::/, ''))}`}>
                    {record.approval_snapshot?.code ? `#${record.approval_snapshot.code}` : 'Xem đề xuất'}
                    {record.approval_snapshot?.subject && <small className="leave-days-source-subject">{record.approval_snapshot.subject}</small>}
                  </Link> : <span className="leave-days-muted">Thêm trực tiếp</span>}</td>
                <td data-label="Điều chỉnh">{record.adjustment_count > 0
                  ? <button type="button" className="leave-days-text-button" onClick={() => setSelectedRecord(record)}>{record.adjustment_count} lần · Xem ghi chú / tệp</button>
                  : <span className="leave-days-muted">Chưa điều chỉnh</span>}</td>
                <td data-label="Thao tác"><div className="leave-days-row-actions">
                  <button type="button" className="btn" onClick={() => setSelectedRecord(record)}>{canViewAll ? 'Chi tiết / Điều chỉnh' : 'Chi tiết'}</button>
                  {canViewAll && record.status !== 'approved' && <button type="button" className="btn btn-primary leave-days-approve" onClick={() => approve(record)} disabled={approvingId === record.id}>
                    {approvingId === record.id ? 'Đang duyệt...' : 'Duyệt'}
                  </button>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>)}
      </div>}
    </section>
    {selectedRecord && <LeaveDayDetails record={selectedRecord} companyId={companyId} canAdjust={canViewAll} onClose={() => setSelectedRecord(null)} onSaved={updated => {
      const { adjustment_history, ...summary } = updated
      setRecords(current => current.map(row => row.id === summary.id ? summary : row).sort((a, b) => b.leave_date.localeCompare(a.leave_date) || a.id.localeCompare(b.id)))
      setNotice(`Đã lưu điều chỉnh ngày nghỉ của ${updated.employee_name}.`)
    }} />}
  </div>
}

export default LeaveDays
