import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { loadEmployeeLeaveSettings, loadLeaveEmployees } from '../services/employeeLeave'
import { getCompanyIdForUser } from '../utils/companyContext'
import { formatTenure, LEAVE_MONTHS } from '../utils/employeeLeave'
import './EmployeeLeave.css'

function LeaveBoard() {
  const { user } = useAuth()
  const companyId = user?.company_id || user?.companyId || getCompanyIdForUser(user)
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({})
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [search, setSearch] = useState('')
  const [asOf, setAsOf] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [people, leaveSettings] = await Promise.all([
        loadLeaveEmployees(companyId),
        loadEmployeeLeaveSettings(companyId)
      ])
      setEmployees(people)
      setSettings(leaveSettings)
      setAsOf(new Date())
    } catch (requestError) {
      setError(requestError.message || 'Không tải được Bảng phép.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { reload() }, [reload])

  const years = useMemo(() => [...new Set([
    String(new Date().getFullYear()),
    String(new Date().getFullYear() + 1),
    String(new Date().getFullYear() + 2),
    ...Object.values(settings).flatMap(data => Object.keys(data))
  ])].sort((a, b) => Number(a) - Number(b)), [settings])

  const rows = useMemo(() => employees.filter(employee => {
    const query = search.trim().toLocaleLowerCase('vi')
    return !query || `${employee.ho_va_ten} ${employee.employeeId}`.toLocaleLowerCase('vi').includes(query)
  }), [employees, search])

  return (
    <div className="leave-board-page">
      <header className="leave-board-header">
        <div>
          <h1>Bảng phép</h1>
          <p>Theo dõi thâm niên, tổng phép năm và phân bổ phép tháng của nhân sự.</p>
        </div>
        <div className="leave-board-header-actions">
          <button type="button" className="btn" onClick={reload} disabled={loading}>
            <i className="fas fa-sync-alt" aria-hidden="true" /> {loading ? 'Đang cập nhật...' : 'Cập nhật tự động'}
          </button>
          <Link className="btn btn-primary" to="/holiday-settings?tab=leave">Cài đặt phép</Link>
        </div>
      </header>

      <div className="leave-board-filters">
        <label>Năm phép
          <select value={year} onChange={event => setYear(event.target.value)}>
            {years.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Tìm nhân sự
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên hoặc mã nhân sự" />
        </label>
        <span className="leave-board-count">{rows.length} nhân sự</span>
      </div>

      {error && <div className="holiday-settings-alert is-error" role="alert">{error}</div>}
      {loading ? <p className="leave-empty">Đang tải Bảng phép...</p> : rows.length === 0 ? (
        <p className="leave-empty">Không tìm thấy nhân sự.</p>
      ) : (
        <div className="leave-board-scroll" role="region" aria-label={`Bảng phép năm ${year}`} tabIndex="0">
          <table className="leave-board-table">
            <thead><tr>
              <th scope="col">Nhân sự</th>
              <th scope="col">Thâm niên</th>
              <th scope="col">Phép năm {year}</th>
              {LEAVE_MONTHS.map(month => <th scope="col" key={month}>Tháng {month}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(employee => {
                const data = settings[employee.id]?.[year]
                return <tr key={employee.id}>
                  <th scope="row"><strong>{employee.ho_va_ten || employee.employeeId}</strong><small>{employee.employeeId}</small></th>
                  <td>{formatTenure(employee.ngay_vao_lam, asOf)}</td>
                  <td className="leave-board-total">{data ? data.total_leave : 'Chưa cài'}</td>
                  {LEAVE_MONTHS.map(month => <td key={month}>{data?.months?.[month] ?? '—'}</td>)}
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default LeaveBoard
