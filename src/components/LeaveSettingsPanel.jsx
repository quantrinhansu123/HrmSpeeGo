import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adjustLeaveBalance, configureLeaveYear, confirmLeaveContinuation, loadLeaveBoard, loadLeaveEmployees, recalculateLeave, saveMonthlyLeave } from '../services/employeeLeave'
import { formatLeaveAmount, leaveEligibilityDate, LEAVE_MONTHS, parseLeaveAmount, validateMonthlyLeaveInput } from '../utils/employeeLeave'
import '../pages/EmployeeLeave.css'

const historyLabels = { opening: 'Số đầu kỳ', automatic: 'Cấp phép cuối tháng', monthly_override: 'Điều chỉnh phép tháng',
  adjustment: 'Điều chỉnh số dư', carryover: 'Nhận phép bảo lưu', transfer_out: 'Chuyển phép sang năm khác', settlement: 'Thanh toán phép',
  continuation_continued: 'Tiếp tục hợp đồng sau 6 tháng', continuation_stopped: 'Dừng hợp đồng tại mốc 6 tháng' }

function EmployeeYear({ employee, year, account, busy, perform }) {
  const [months, setMonths] = useState({})
  const [note, setNote] = useState('')
  const [opening, setOpening] = useState('')
  const [throughMonth, setThroughMonth] = useState('0')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState('adjustment')
  const [sourceYear, setSourceYear] = useState(String(Number(year) - 1))
  const [error, setError] = useState('')
  useEffect(() => {
    setMonths(Object.fromEntries(LEAVE_MONTHS.map(month => [month, account?.months?.[month]?.override ?? ''])))
    setNote('')
  }, [account])
  const submit = async action => {
    setError('')
    try { await perform(action) } catch (e) { setError(e.message) }
  }
  const employeeId = employee.id
  return <div className="leave-employee-content">
    {error && <p role="alert" className="holiday-settings-alert is-error">{error}</p>}
    {!account?.configured ? <fieldset className="leave-year-body" disabled={busy}>
      <legend>Đối soát và mở phép theo tháng năm {year}</legend>
      <p>Mốc đủ 6 tháng tròn: {leaveEligibilityDate(employee)?.split('-').reverse().join('/') || 'Cần bổ sung ngày chính thức'}; phải tiếp tục hợp đồng mới được cấp phép.</p>
      {account?.legacy_total != null && <p>Tổng phép năm cũ: <strong>{formatLeaveAmount(account.legacy_total)}</strong>. Cần xác nhận số đã cấp, không tự chia đều.</p>}
      <p>Nhập tổng số phép đã cấp đến hết kỳ đối soát, <strong>chưa trừ</strong> các đơn đã nghỉ/chờ duyệt. Nhập 0 nếu bắt đầu tính từ đầu năm.</p>
      <div className="leave-month-grid">
        <label>Phép đã cấp<input inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} /></label>
        <label>Đã tính đến hết<select value={throughMonth} onChange={e => setThroughMonth(e.target.value)}>
          <option value="0">Đầu năm (chưa tính tháng nào)</option>
          {LEAVE_MONTHS.map(m => <option key={m} value={m}>Tháng {m}/{year}</option>)}
        </select></label>
      </div>
      <label>Ghi chú đối soát<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>
      <button className="btn btn-primary" type="button" onClick={() => {
        if (parseLeaveAmount(opening) === null || note.trim().length < 5) { setError('Nhập số phép hợp lệ và ghi chú từ 5 ký tự.'); return }
        submit(() => configureLeaveYear({ employeeId, year, opening, throughMonth, note }))
      }}>Xác nhận số đầu kỳ và mở phép tháng</button>
    </fieldset> : <>
      {!account.continued && <fieldset className="leave-year-body" disabled={busy}>
        <legend>{account.continuation === 'stopped' ? 'Dừng hợp đồng tại mốc 6 tháng — không cấp phép' : 'Xác nhận tiếp tục sau đủ 6 tháng tròn'}</legend>
        <p>{formatLeaveAmount(account.provisional)} ngày dự tính, chưa được cấp. Dừng tại mốc 6 tháng: không cấp phép. Tiếp tục làm: cộng bù các tháng đủ điều kiện, gồm thời gian thử việc.</p>
        <p>Hệ thống tự xác nhận khi bảng công ghi nhận ngày làm thực tế từ mốc {account.eligible_from || 'cần bổ sung ngày chính thức'}. HR có thể xác nhận theo hợp đồng.</p>
        <label>Căn cứ xác nhận<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>
        <div className="leave-board-header-actions">
          <button className="btn btn-primary" onClick={() => submit(() => confirmLeaveContinuation({ employeeId, decision: 'continued', note }))}>Xác nhận tiếp tục và cộng phép</button>
          <button className="btn" onClick={() => submit(() => confirmLeaveContinuation({ employeeId, decision: 'stopped', note }))}>Dừng tại mốc 6 tháng, không cấp phép</button>
        </div>
      </fieldset>}
      <p className="leave-policy-note">Đã cấp đầu kỳ: {formatLeaveAmount(account.opening)} ngày, đến hết tháng {account.through_month}/{year}. Bỏ trống ô để dùng số tự tính; nhập 0 để xác nhận không cấp. Số nhập thay thế số tự tính của tháng.</p>
      <fieldset className="leave-year-body" disabled={busy}>
        <legend>Phép cấp từng tháng năm {year}</legend>
        <div className="leave-month-grid">{LEAVE_MONTHS.map(month => {
          const period = account.months?.[month]
          const covered = Number(month) <= account.through_month
          const today = new Date()
          const closed = Number(year) < today.getFullYear() || (Number(year) === today.getFullYear() && Number(month) < today.getMonth() + 1)
          return <label key={month}>Tháng {month}
            <input aria-label={'Phép tháng ' + month + ' năm ' + year} inputMode="decimal" value={months[month] ?? ''}
              disabled={covered || !closed} placeholder={covered ? 'Đã tính đầu kỳ' : !closed ? 'Chưa hết tháng' : 'Tự động'}
              onChange={e => setMonths(current => ({ ...current, [month]: e.target.value }))} />
            <small>{covered ? 'Đã nằm trong số đầu kỳ' : period ? 'Tự tính: ' + formatLeaveAmount(period.automatic) + ' · ' + (period.status === 'pending' ? 'Chờ bảng công' : period.status === 'qualified' ? 'Đủ điều kiện' : 'Không đủ điều kiện') : 'Chưa chốt tháng'}</small>
          </label>
        })}</div>
        <label>Lý do điều chỉnh<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>
        <button className="btn btn-primary" type="button" onClick={() => {
          const validation = validateMonthlyLeaveInput(months, note)
          if (validation) { setError(validation); return }
          submit(() => saveMonthlyLeave({ employeeId, year, months, expectedVersion: account.version, note }))
        }}>Lưu phép theo tháng</button>
      </fieldset>
      <details className="leave-balance-adjustment"><summary>Điều chỉnh số dư / bảo lưu / thanh toán</summary>
        <fieldset className="leave-year-body" disabled={busy}>
          <label>Loại giao dịch<select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="adjustment">Điều chỉnh cộng/trừ</option><option value="carryover">Gộp phép từ năm trước theo thỏa thuận</option><option value="settlement">Thanh toán phép chưa nghỉ</option>
          </select></label>
          {kind === 'carryover' && <label>Năm nguồn<input inputMode="numeric" value={sourceYear} onChange={e => setSourceYear(e.target.value)} /></label>}
          <label>Số ngày {kind === 'adjustment' ? '(âm để giảm)' : ''}<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label>Lý do / căn cứ thỏa thuận<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>
          <button className="btn" type="button" onClick={() => {
            if (!/^-?\d+([.,]\d+)?$/.test(amount.trim()) || Number(amount.replace(',', '.')) === 0 || note.trim().length < 5) {
              setError('Nhập số ngày khác 0 và ghi chú từ 5 ký tự.'); return
            }
            submit(() => adjustLeaveBalance({ employeeId, year, amount, kind, sourceYear, note }))
          }}>Ghi giao dịch</button>
        </fieldset>
      </details>
      <details><summary>Lịch sử cấp và điều chỉnh phép</summary><ol className="leave-audit-list">
        {(account.history || []).map(entry => <li key={entry.id}>
          <strong>{entry.actor_name || 'Tự động'}</strong> · {new Date(entry.created_at).toLocaleString('vi-VN')}
          <p>{entry.note}</p><small>{historyLabels[entry.kind] || 'Cập nhật phép'}{entry.month ? ' · Tháng ' + entry.month : ''}{entry.amount != null ? ' · ' + formatLeaveAmount(entry.amount) + ' ngày' : ''}</small>
        </li>)}
      </ol></details>
    </>}
  </div>
}

export default function LeaveSettingsPanel({ companyId }) {
  const [employees, setEmployees] = useState([])
  const [board, setBoard] = useState({})
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [open, setOpen] = useState(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    const [people, accounts] = await Promise.all([loadLeaveEmployees(companyId), loadLeaveBoard(year)])
    setEmployees(people); setBoard(accounts || {})
  }, [companyId, year])
  useEffect(() => {
    let active = true
    setBusy(true); setError('')
    setBoard({}); setEmployees([])
    Promise.all([loadLeaveEmployees(companyId), loadLeaveBoard(year)]).then(([people, accounts]) => {
      if (active) { setEmployees(people); setBoard(accounts || {}) }
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [companyId, year])
  const perform = async action => {
    setBusy(true); setError(''); setNotice('')
    try { await action(); await load(); setNotice('Đã cập nhật phép và lưu lịch sử.') }
    finally { setBusy(false) }
  }
  return <section className="leave-settings-panel" role="tabpanel" aria-label="Cài đặt phép">
    <div className="leave-settings-toolbar"><div><h2>Cài đặt phép theo tháng</h2><p>Cấp phép cuối tháng sau đủ 6 tháng tròn và tiếp tục hợp đồng; cộng bù các tháng đủ điều kiện trước đó.</p></div><Link className="btn" to="/bang-phep">Xem Bảng phép</Link></div>
    <div className="leave-board-filters">
      <label>Năm phép<select value={year} disabled={busy} onChange={e => { setYear(e.target.value); setOpen(null) }}>
        {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 5 + i).map(y => <option key={y} value={y}>{y}</option>)}
      </select></label>
      <label>Tìm nhân sự<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên hoặc mã nhân sự" /></label>
      <button className="btn" disabled={busy} onClick={() => perform(recalculateLeave).catch(e => setError(e.message))}>Đối soát lại các tháng đã kết thúc</button>
    </div>
    {error && <p role="alert" className="holiday-settings-alert is-error">{error}</p>}
    {notice && <p role="status" className="holiday-settings-alert is-success">{notice}</p>}
    {busy && <p role="status">Đang cập nhật...</p>}
      <div className="leave-employee-list">{employees.filter(e => (e.ho_va_ten + ' ' + e.employeeId).toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))).map(employee => <article className="leave-employee" key={employee.id}>
      <button className="leave-employee-toggle" type="button" disabled={busy} aria-expanded={open === employee.id} onClick={() => setOpen(open === employee.id ? null : employee.id)}>
        <span><strong>{employee.ho_va_ten}</strong><small>{employee.employeeId} · {board[employee.id]?.configured ? formatLeaveAmount(board[employee.id].total) + ' ngày tích lũy' : 'Chưa đối soát đầu kỳ'}</small></span>
        <span aria-hidden="true">{open === employee.id ? '−' : '+'}</span>
      </button>
      {open === employee.id && <EmployeeYear key={employee.id + '-' + year} employee={employee} year={year} account={board[employee.id]} busy={busy} perform={perform} />}
    </article>)}</div>
  </section>
}
