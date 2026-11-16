import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { loadLeaveBoard, loadLeaveEmployees } from '../services/employeeLeave'
import { getCompanyIdForUser } from '../utils/companyContext'
import { formatLeaveAmount, formatTenure, LEAVE_MONTHS } from '../utils/employeeLeave'
import './EmployeeLeave.css'

function LeaveBoard() {
  const { user } = useAuth()
  const companyId = user?.company_id || user?.companyId || getCompanyIdForUser(user)
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({})
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [asOf, setAsOf] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestVersion = useRef(0)

  const reload = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    setSettings({})
    try {
      const [people, leaveSettings] = await Promise.all([
        loadLeaveEmployees(companyId),
        loadLeaveBoard(year)
      ])
      if (version !== requestVersion.current) return
      setEmployees(people)
      setSettings(leaveSettings)
      setAsOf(new Date())
    } catch (requestError) {
      if (version !== requestVersion.current) return
      setError(requestError.message || 'Không tải được Bảng phép.')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [companyId, year])

  useEffect(() => { reload() }, [reload])

  const years = useMemo(() => [...new Set([
    String(new Date().getFullYear()),
    String(new Date().getFullYear() + 1),
    String(new Date().getFullYear() + 2),
    ...Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i - 1))
  ])].sort((a, b) => Number(a) - Number(b)), [settings])

  const departments = useMemo(() => [...new Set(employees.map(employee => employee.bo_phan).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'vi')), [employees])
  const hasUnassignedDepartment = employees.some(employee => !employee.bo_phan)

  const rows = useMemo(() => employees.filter(employee => {
    const query = search.trim().toLocaleLowerCase('vi')
    const matchesSearch = !query || `${employee.ho_va_ten} ${employee.employeeId} ${employee.bo_phan || ''}`.toLocaleLowerCase('vi').includes(query)
    const matchesDepartment = !department
      || (department === '__none__' ? !employee.bo_phan : employee.bo_phan === department)
    return matchesSearch && matchesDepartment
  }), [employees, search, department])

  return (
    <div className="leave-board-page">
      <header className="leave-board-header">
        <div>
          <h1>Bảng phép</h1>
          <p>Phép theo tháng; đủ 6 tháng tròn và tiếp tục hợp đồng mới được cấp. Dừng tại mốc 6 tháng không được cấp phép.</p>
        </div>
        <div className="leave-board-header-actions">
          <button type="button" className="btn" onClick={reload} disabled={loading}>
            <i className="fas fa-sync-alt" aria-hidden="true" /> {loading ? 'Đang tải...' : 'Tải lại'}
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
        <label>Phòng ban
          <select value={department} onChange={event => setDepartment(event.target.value)}>
            <option value="">Tất cả phòng ban</option>
            {hasUnassignedDepartment && <option value="__none__">Chưa phân bộ phận</option>}
            {departments.map(item => <option key={item} value={item}>{item}</option>)}
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
              <th scope="col">Được dùng từ</th>
              {LEAVE_MONTHS.map(month => <th scope="col" key={month}>T{month}</th>)}
              <th scope="col">Đầu kỳ</th><th scope="col">Đã cấp</th><th scope="col">Dự tính chờ tiếp tục</th><th scope="col">Đang khóa</th>
              <th scope="col">Đã nghỉ</th><th scope="col">Chờ duyệt</th><th scope="col">Còn khả dụng</th>
            </tr></thead>
            <tbody>
              {rows.map(employee => {
                const data = settings[employee.id]
                return <tr key={employee.id}>
                  <th scope="row"><strong>{employee.ho_va_ten || employee.employeeId}</strong><small>{[employee.employeeId, employee.bo_phan].filter(Boolean).join(' · ') || '—'}</small></th>
                  <td data-label="Thâm niên">{formatTenure(employee.ngay_vao_lam, asOf)}</td>
                  <td>{data?.eligible_from ? data.eligible_from.split('-').reverse().join('/') : 'Thiếu ngày chính thức'}<small>{data?.eligible ? 'Đã tiếp tục, được dùng phép' : data?.continuation === 'stopped' ? 'Dừng hợp đồng, không cấp phép' : 'Chưa xác nhận tiếp tục'}</small></td>
                  {LEAVE_MONTHS.map(month => {
                    const period = data?.months?.[month]
                    return <td key={month} title={period?.override != null ? 'HR điều chỉnh' : period?.status === 'pending' ? 'Chờ đối soát bảng công' : 'Tự tính'}>
                      {Number(month) <= (data?.through_month ?? -1) ? 'Đầu kỳ' : period ? (data?.continuation === 'stopped' ? 'Không cấp' : formatLeaveAmount(period.amount) + (data?.continued ? '' : ' dự tính') + (period.override != null ? '*' : '')) : '—'}
                    </td>
                  })}
                  <td>{data?.configured ? formatLeaveAmount(data.opening) : '—'}</td>
                  <td className="leave-board-total">{data?.configured ? formatLeaveAmount(data.total) : 'Chưa đối soát'}</td>
                  <td>{formatLeaveAmount(data?.provisional)}</td>
                  <td>{formatLeaveAmount(data?.locked)}</td><td>{formatLeaveAmount(data?.used)}</td>
                  <td>{formatLeaveAmount(data?.reserved)}</td><td className="leave-board-total">{data?.configured ? formatLeaveAmount(data.remaining) : '—'}</td>
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
