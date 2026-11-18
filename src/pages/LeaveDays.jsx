import { useCallback, useEffect, useMemo, useState } from 'react'
import LeaveDayDetails from '../components/LeaveDayDetails'
import { useAuth } from '../contexts/AuthContext'
import { loadLeaveEmployees } from '../services/employeeLeave'
import { approveLeaveDay, deleteLeaveDays, loadLeaveDays } from '../services/leaveDays'
import { getCompanyIdForUser } from '../utils/companyContext'
import { formatLeaveDate } from '../utils/leaveDays'
import { leaveDaysOutsideRequests } from '../utils/approvalLeave'
import './LeaveDays.css'

const UNASSIGNED_DEPARTMENT = 'Chưa có phòng ban'

function LeaveDays({ request = null, requests = null }) {
  const { user } = useAuth()
  const companyId = user?.company_id || user?.companyId || getCompanyIdForUser(user)
  const canViewAll = user?.role === 'admin' || user?.role === 'hr'
  const requestId = request?.id
  const [records, setRecords] = useState([])
  const [departmentsByEmployee, setDepartmentsByEmployee] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [approvingId, setApprovingId] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await loadLeaveDays({ companyId, employeeId: canViewAll ? null : user.id, approvalRequestId: requestId })
      let people = []
      if (canViewAll && !requestId) {
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
  }, [companyId, canViewAll, user.id, user.bo_phan, user.department, requestId])

  useEffect(() => { reload() }, [reload])

  const departmentGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    const grouped = new Map()
    const visibleRecords = requests ? leaveDaysOutsideRequests(records, requests) : records
    visibleRecords.forEach(record => {
      if (statusFilter && record.status !== statusFilter) return
      const department = String(departmentsByEmployee[record.employee_id] || '').trim()
      const label = requestId ? 'Ngày nghỉ theo đề xuất' : department || UNASSIGNED_DEPARTMENT
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
  }, [records, requests, requestId, search, departmentsByEmployee, statusFilter])

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

  return <div className="leave-days-page leave-days-page--embedded">
    {error && <div className="leave-days-message is-error" role="alert">{error}</div>}
    {notice && <div className="leave-days-message is-success" role="status">{notice}</div>}

    <section className="leave-days-list">
      <div className="leave-days-list-head">
        <div>
          <h2>{requestId ? 'Ngày nghỉ đã ghi nhận' : 'Ngày nghỉ ngoài danh sách đề xuất'}</h2>
          <p className="leave-days-muted">{requestId
            ? 'Ngày nghỉ được ghi nhận khi đề xuất được duyệt bước cuối. Chọn chi tiết để xem lịch sử điều chỉnh.'
            : 'Các ngày đã thêm trực tiếp hoặc có đề xuất gốc không còn trong danh sách. Lịch sử và tệp điều chỉnh vẫn được giữ.'}</p>
        </div>
        <div className="leave-days-list-tools">
          <label>Trạng thái<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="">Tất cả</option><option value="approved">Đã duyệt</option><option value="pending">Chờ duyệt</option>
          </select></label>
          {canViewAll && !requestId && <label>Tìm nhân sự
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
        <p className="leave-days-empty">{requestId && !canViewAll && request.requesterId !== user.id
          ? 'Bạn chỉ có quyền xem ngày nghỉ đã ghi nhận của mình.'
          : requestId && request.status !== 'approved'
            ? 'Đề xuất chưa được duyệt bước cuối nên chưa ghi nhận ngày nghỉ.'
            : requestId ? 'Không có ngày nghỉ đã ghi nhận cho đề xuất này.' : 'Không có ngày nghỉ ngoài danh sách đề xuất.'}</p>
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
                {!requestId && <th scope="col">Tên người nghỉ</th>}<th scope="col">Ngày nghỉ phép</th><th scope="col">Lý do</th><th scope="col">Trạng thái</th>{!requestId && <th scope="col">Đề xuất liên quan</th>}<th scope="col">Điều chỉnh</th><th scope="col">Thao tác</th>
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
                {!requestId && <td data-label="Tên người nghỉ">{record.employee_name}</td>}
                <td data-label="Ngày nghỉ phép">{formatLeaveDate(record.leave_date)}</td>
                <td data-label="Lý do">{record.reason || '—'}</td>
                <td data-label="Trạng thái"><span className={`leave-days-status is-${record.status || 'pending'}`}>{record.status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}</span></td>
                {!requestId && <td data-label="Đề xuất liên quan">{record.approval_request_id
                  ? <span>
                    {record.approval_snapshot?.code ? `#${record.approval_snapshot.code}` : 'Đề xuất nghỉ phép'}
                    {record.approval_snapshot?.subject && <small className="leave-days-source-subject">{record.approval_snapshot.subject}</small>}
                    <small className="leave-days-source-subject leave-days-muted">Không còn trong danh sách đề xuất</small>
                  </span> : <span className="leave-days-muted">Thêm trực tiếp</span>}</td>}
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
