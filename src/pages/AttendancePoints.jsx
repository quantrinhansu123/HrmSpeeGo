import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fbGet, fbListCollectionIds } from '../services/firebase'
import { listPenaltyEmployeesSlim, listPenaltyMonths } from '../services/attendancePenaltiesDb'
import { loadAttendancePointMonth, saveAttendancePointMonth } from '../services/attendancePointsDb'
import { hydrateAttendanceSummaryRows } from '../utils/attendanceSummary'
import {
  ATTENDANCE_POINT_TYPES, ATTENDANCE_BENEFIT_GROUPS, buildAttendancePointEvents,
  createManualPointEvent, isTimedPointEvent, mergeAttendancePointEvents, pointRuleForEvent,
  summarizeEmployeePoints, attachSavedAttendancePoints
} from '../utils/attendancePoints'
import './AttendancePenalties.css'
import './AttendancePoints.css'

const number = value => Number(value || 0).toLocaleString('vi-VN')
const statusLabels = { pending: 'Chờ HCNS kiểm tra', confirmed: 'Xác nhận trừ điểm', exempt: 'Miễn điểm' }
const emptyState = { rows: [], benefits: {}, version: 0, generatedAt: '' }

function EventEditor({ item, employees, onUpdate, onDelete, mobile = false }) {
  const setType = type => {
    const minutes = isTimedPointEvent(type) ? Math.max(1, item.minutes || 1) : 0
    onUpdate({ eventType: type, minutes, ...pointRuleForEvent(type, minutes), reviewStatus: 'pending' })
  }
  const controls = [
    ['Ngày', <input aria-label="Ngày vi phạm" disabled={item.source === 'auto'} type="date" value={item.date} onChange={event => onUpdate({ date: event.target.value, reviewStatus: 'pending' })} />],
    ['Nhân sự', <select aria-label="Nhân sự" disabled={item.source === 'auto'} value={item.employeeId} onChange={event => {
      const employee = employees.find(row => row.id === event.target.value)
      onUpdate({ employeeId: employee?.id || '', employeeCode: employee?.code || '', employeeName: employee?.name || '', reviewStatus: 'pending' })
    }}><option value="">Chọn nhân sự</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name} · {employee.code}</option>)}</select>],
    ['Hành vi', <select aria-label="Hành vi" disabled={item.source === 'auto'} value={item.eventType} onChange={event => setType(event.target.value)}>{ATTENDANCE_POINT_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}</select>],
    ['Phút', isTimedPointEvent(item.eventType) ? <input aria-label="Số phút" disabled={item.source === 'auto'} type="number" min="1" max="1440" step="1" value={item.minutes} onChange={event => {
      const minutes = Number(event.target.value)
      onUpdate({ minutes, ...pointRuleForEvent(item.eventType, minutes), reviewStatus: 'pending' })
    }} /> : <span>—</span>],
    ['Điểm', <strong>{item.points}</strong>],
    ['Nội dung', <input aria-label="Nội dung sự kiện" value={item.content || ''} onChange={event => onUpdate({ content: event.target.value })} />],
    ['Kết quả kiểm tra', <select aria-label="Kết quả kiểm tra" value={item.reviewStatus} onChange={event => onUpdate({ reviewStatus: event.target.value })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>],
    ['Ghi nhận / lý do của HCNS', <input aria-label="Ghi nhận hoặc lý do của HCNS" value={item.note || ''} placeholder="Bắt buộc khi xác nhận / miễn" onChange={event => onUpdate({ note: event.target.value })} />],
    ['Nguồn', <small>{item.source === 'auto' ? 'Chấm công' : 'Nhập tay'}{item.reviewedAt ? ` · ${new Date(item.reviewedAt).toLocaleString('vi-VN')}` : ''}</small>],
    ['Thao tác', <button type="button" className="is-danger" onClick={onDelete}>Xóa</button>]
  ]
  return mobile ? controls.map(([label, control]) => <label className="penalty-card__field" key={label}><span>{label}</span>{control}</label>)
    : controls.map(([label, control]) => <td key={label}>{control}</td>)
}

export default function AttendancePoints({ month, onMonthChange }) {
  const { user } = useAuth()
  const canEdit = ['admin', 'hr'].includes(user?.role)
  const [state, setState] = useState(emptyState)
  const [employees, setEmployees] = useState([])
  const [months, setMonths] = useState([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setNotice('')
    Promise.all([loadAttendancePointMonth(month), listPenaltyEmployeesSlim()]).then(([next, directory]) => {
      if (!active) return
      setState(next); setEmployees(directory); setDirty(false)
    }).catch(requestError => {
      if (active) setError(requestError.message || 'Không tải được bảng điểm.')
    }).finally(() => { if (active) setLoading(false) })
    Promise.allSettled([listPenaltyMonths(), fbListCollectionIds('attendanceMonthSummaries')]).then(results => {
      if (active) setMonths([...new Set([month, ...results.flatMap(result => result.status === 'fulfilled' ? result.value : [])])].sort().reverse())
    })
    return () => { active = false }
  }, [month, reload])

  const summaries = useMemo(() => {
    const directory = new Map(employees.map(employee => [String(employee.id), employee]))
    state.rows.forEach(row => {
      if (row.employeeId && !directory.has(String(row.employeeId))) directory.set(String(row.employeeId), { id: row.employeeId, name: row.employeeName, code: row.employeeCode })
    })
    return [...directory.values()].map(employee => ({
      ...employee, group: state.benefits[employee.id] || 'unassigned',
      ...summarizeEmployeePoints(state.rows, employee.id, state.benefits[employee.id] || 'unassigned')
    }))
  }, [employees, state])
  const pendingCount = state.rows.filter(row => row.reviewStatus === 'pending').length
  const confirmedCount = state.rows.filter(row => row.reviewStatus === 'confirmed').length
  const totalPoints = summaries.reduce((sum, row) => sum + row.deductedPoints, 0)
  const update = (id, patch) => {
    setState(current => ({ ...current, rows: current.rows.map(row => row.id === id ? { ...row, ...patch } : row) }))
    setDirty(true); setNotice('')
  }
  const changeMonth = next => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return
    if (dirty && !confirm('Đổi tháng sẽ bỏ các thay đổi chưa lưu. Tiếp tục?')) return
    onMonthChange(next)
  }
  const fill = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      const snapshot = await fbGet(`hr/attendanceMonthSummaries/${month}`)
      if (!snapshot?.rows?.length) throw new Error('Chưa có bảng công tổng hợp tháng này. Hãy tổng hợp Bảng công trước.')
      const generated = buildAttendancePointEvents(hydrateAttendanceSummaryRows(snapshot.rows).map(row => ({ ...row, month })))
      setState(current => ({ ...current, rows: mergeAttendancePointEvents(current.rows, generated) }))
      setDirty(true)
      setNotice('Đã nạp các sự kiện. Kiểm tra xin phép / giải trình và ghi nhận trước khi xác nhận trừ hoặc miễn điểm.')
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }
  const save = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      const next = await saveAttendancePointMonth(month, state.rows, state.benefits, state.version)
      setState(next); setDirty(false)
      setNotice('Đã lưu bảng điểm. Nhân viên xem các sự kiện đã xác nhận / miễn tại Bảng công cá nhân.')
    } catch (requestError) { setError(requestError.message || 'Không lưu được bảng điểm.') } finally { setSaving(false) }
  }
  const exportReport = async () => {
    setSaving(true); setError('')
    try {
      const saved = await loadAttendancePointMonth(month)
      const { downloadAttendancePointsReport } = await import('../utils/attendancePointExcel')
      const reportRows = employees.map(employee => ({ employeeId: employee.id, employeeName: employee.name, employeeCode: employee.code }))
      await downloadAttendancePointsReport(attachSavedAttendancePoints(reportRows, saved.rows, saved.benefits), month)
      setNotice(dirty ? 'Đã xuất dữ liệu đã lưu; thay đổi đang nhập chưa được xuất.' : 'Đã xuất dữ liệu đã lưu.')
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  return <div className="attendance-penalties-page attendance-points-page">
    <header><div><h1>Điểm chuyên cần</h1><p>Áp dụng từ 11/2026 · 100 điểm/người/tháng{dirty ? ' · Có thay đổi chưa lưu' : ''}</p></div>
      <div className="attendance-penalties-actions">
        <label>Tháng<input type="month" value={month} disabled={saving} onChange={event => changeMonth(event.target.value)} /></label>
        <label>Các kỳ<select value={month} disabled={saving} onChange={event => changeMonth(event.target.value)}>{[...new Set([month, ...months])].map(value => <option key={value}>{value}</option>)}</select></label>
        <button disabled={saving || loading} onClick={() => { if (!dirty || confirm('Tải lại sẽ bỏ các thay đổi chưa lưu. Tiếp tục?')) setReload(value => value + 1) }}>Tải lại</button>
        <button disabled={saving || loading} onClick={exportReport}>Xuất Excel đã lưu</button>
        {canEdit && <><button disabled={saving || loading} onClick={fill}>Nạp từ chấm công</button>
          <button disabled={saving || loading} onClick={() => { setState(current => ({ ...current, rows: [...current.rows, createManualPointEvent(month)] })); setDirty(true) }}>+ Thêm sự kiện</button>
          <button className="is-primary" disabled={saving || loading || !dirty} onClick={save}>{saving ? 'Đang xử lý...' : 'Lưu bảng điểm'}</button></>}
      </div>
    </header>
    {error && <p className="attendance-penalties-state is-error" role="alert">{error}</p>}
    {notice && <p className="attendance-points-notice" role="status">{notice}</p>}
    {loading ? <p className="attendance-penalties-state">Đang tải bảng điểm...</p> : <>
      <p className="attendance-points-note">Phúc lợi chuyên cần ngoài lương: nhân viên chính thức tối đa 1.000.000đ, quản lý chính thức 2.000.000đ. Chỉ sự kiện HCNS xác nhận mới trừ điểm. HCNS chọn nhóm hưởng trong kỳ; chưa xác định nhóm thì chưa tính tiền.</p>
      <section className="attendance-penalties-summary" aria-label="Tổng hợp điểm"><div><span>Đã xác nhận</span><strong>{confirmedCount}</strong><small>sự kiện · {totalPoints} điểm trừ</small></div><div><span>Chờ HCNS kiểm tra</span><strong>{pendingCount}</strong><small>sự kiện chưa trừ điểm</small></div></section>
      <fieldset className="attendance-points-editor" disabled={!canEdit || saving}>
        <legend>Chuyên cần từng người</legend>
        <div className="attendance-points-employees">{summaries.map(employee => <article className="attendance-points-person" key={employee.id}>
          <strong>{employee.name} <small>{employee.code}</small></strong>
          <label>Nhóm hưởng trong tháng<select value={employee.group} onChange={event => {
            const group = event.target.value
            setState(current => ({ ...current, benefits: { ...current.benefits, [employee.id]: group } })); setDirty(true)
          }}>{ATTENDANCE_BENEFIT_GROUPS.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label>
          <p><b>{employee.remainingPoints}/100 điểm</b> · đã trừ {employee.deductedPoints} · chờ kiểm tra {employee.pendingPoints} điểm</p>
          <p>Phúc lợi dự kiến: <b>{employee.benefitAmount === null ? 'Chưa xác định nhóm' : `${number(employee.benefitAmount)} đ`}</b>{employee.pendingCount > 0 ? ' · Chưa kiểm tra xong' : ''}</p>
          {employee.needsDisciplineReview && <p className="attendance-points-warning">Chuyển HCNS xem xét tần suất: {employee.frequencyCount} lần / {employee.absenceDays} ngày nghỉ không phép. Không tự áp kỷ luật.</p>}
        </article>)}</div>
        <h2 className="attendance-points-events-heading">Sự kiện và ghi nhận HCNS</h2>
        <p className="attendance-points-note">Muộn/sớm/ra ngoài: dưới 30 phút trừ 10; từ 30 đến hết 60 phút trừ 20; trên 60 phút trừ 30. Quên chấm không giải trình được trừ 10; tối đa 2 lần giải trình/tháng. Nghỉ không phép trừ 40/ngày; vi phạm Điều 10 trừ 10/lần. Sửa dữ liệu chấm công tại Bảng công rồi nạp lại để đối soát.</p>
        {state.rows.length === 0 ? <p className="attendance-penalties-state">Chưa có sự kiện. Nạp từ chấm công hoặc thêm sự kiện để ghi nhận.</p> : <>
          <div className="attendance-penalties-card attendance-penalties-card--desktop"><div className="attendance-penalties-scroll"><table className="attendance-penalties-table"><thead><tr>{['Ngày','Nhân sự','Hành vi','Phút','Điểm','Nội dung','Kết quả kiểm tra','Ghi nhận / lý do HCNS','Nguồn',''].map((label, index) => <th key={index}>{label}</th>)}</tr></thead><tbody>{state.rows.map(item => <tr key={item.id}><EventEditor item={item} employees={summaries} onUpdate={patch => update(item.id, patch)} onDelete={() => { setState(current => ({ ...current, rows: current.rows.filter(row => row.id !== item.id) })); setDirty(true) }} /></tr>)}</tbody></table></div></div>
          <div className="attendance-penalties-mobile">{state.rows.map(item => <article className="penalty-card" key={item.id}><EventEditor mobile item={item} employees={summaries} onUpdate={patch => update(item.id, patch)} onDelete={() => { setState(current => ({ ...current, rows: current.rows.filter(row => row.id !== item.id) })); setDirty(true) }} /></article>)}</div>
        </>}
      </fieldset>
    </>}
  </div>
}
