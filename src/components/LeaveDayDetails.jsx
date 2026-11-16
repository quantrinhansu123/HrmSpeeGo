import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { adjustLeaveDay, loadLeaveDayDetails } from '../services/leaveDays'
import { formatLeaveDate, LEAVE_REASON_OPTIONS } from '../utils/leaveDays'
import { readAttachmentFiles } from '../utils/attachments'
import AttachmentLinks from './AttachmentLinks'

const formatTime = value => new Date(value).toLocaleString('vi-VN')

export default function LeaveDayDetails({ record, companyId, canAdjust, onClose, onSaved }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  const [leaveDate, setLeaveDate] = useState(record.leave_date)
  const [reason, setReason] = useState(record.reason || LEAVE_REASON_OPTIONS[0])
  const [note, setNote] = useState('')
  const [attachments, setAttachments] = useState([])
  const dialogRef = useRef(null)
  const busy = saving || reading

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    loadLeaveDayDetails({ companyId, id: record.id }).then(data => {
      if (!active) return
      setDetails(data)
      setLeaveDate(data.leave_date)
      setReason(data.reason || LEAVE_REASON_OPTIONS[0])
    }).catch(requestError => {
      if (active) setError(requestError.message || 'Không tải được chi tiết ngày nghỉ.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [companyId, record.id, version])

  useEffect(() => {
    const previousFocus = document.activeElement
    dialogRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  const handleKeyDown = event => {
    if (event.key === 'Escape' && !busy) onClose()
    if (event.key !== 'Tab') return
    const elements = [...dialogRef.current.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
    const first = elements[0]
    const last = elements.at(-1)
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }

  const attach = async event => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setReading(true)
    setError('')
    try {
      const added = await readAttachmentFiles(files, attachments)
      setAttachments(current => [...current, ...added])
    } catch (fileError) {
      setError(fileError.message)
    } finally { setReading(false) }
  }

  const save = async event => {
    event.preventDefault()
    if (busy || !details) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const updated = await adjustLeaveDay({ id: details.id, leaveDate, reason, note, attachments, expectedUpdatedAt: details.updated_at })
      setDetails(current => ({ ...current, ...updated }))
      setNote('')
      setAttachments([])
      setNotice('Đã lưu điều chỉnh và tệp đi kèm vào lịch sử.')
      onSaved(updated)
    } catch (requestError) {
      setError(requestError.message || 'Không lưu được điều chỉnh ngày nghỉ.')
    } finally { setSaving(false) }
  }

  const approval = details?.approval
  const snapshot = details?.approval_snapshot
  return <div className="leave-days-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section ref={dialogRef} tabIndex={-1} className="leave-days-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-day-detail-title" onKeyDown={handleKeyDown}>
      <header className="leave-days-dialog-head">
        <div><h2 id="leave-day-detail-title">Chi tiết ngày nghỉ</h2><p>{record.employee_name} · {formatLeaveDate(details?.leave_date || record.leave_date)}</p></div>
        <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Đóng chi tiết ngày nghỉ">Đóng</button>
      </header>
      {notice && <div className="leave-days-message is-success" role="status">{notice}</div>}
      {error && <div className="leave-days-message is-error" role="alert">{error} <button type="button" className="btn" disabled={busy || loading} onClick={() => setVersion(current => current + 1)}>Tải lại chi tiết</button></div>}
      {loading ? <p>Đang tải chi tiết...</p> : details && <>
        <section className="leave-days-detail-section">
          <h3>Đề xuất nghỉ phép</h3>
          {details.approval_request_id ? <>
            {approval ? <Link to={`/approvals?view=detail&id=${encodeURIComponent(approval.id)}`}>{approval.code ? `#${approval.code} · ` : ''}{approval.subject || 'Xem đề xuất nghỉ phép'}</Link>
              : <p>{snapshot?.code ? `#${snapshot.code} · ` : ''}{snapshot?.subject || 'Đề xuất nghỉ phép'} — Đề xuất gốc đã được xóa.</p>}
            {details.original_leave_date && <p>Ngày nghỉ theo đề xuất: {formatLeaveDate(details.original_leave_date)}</p>}
            {approval && <>
              <p className="leave-days-note">{approval.content}</p>
              <AttachmentLinks attachments={approval.attachments} />
            </>}
          </> : <p>Ngày nghỉ được thêm trực tiếp.</p>}
        </section>

        <section className="leave-days-detail-section">
          <h3>Lịch sử điều chỉnh ({details.adjustment_count || 0})</h3>
          {details.adjustment_history?.length ? <ol className="leave-days-history">
            {[...details.adjustment_history].reverse().map(entry => <li key={entry.id}>
              <strong>{entry.actorName || 'HR'} · {formatTime(entry.createdAt)}</strong>
              <p>{formatLeaveDate(entry.previousDate)} → {formatLeaveDate(entry.leaveDate)} · {entry.previousReason || '—'} → {entry.reason}</p>
              <p className="leave-days-note">{entry.note}</p>
              <AttachmentLinks attachments={entry.attachments} />
            </li>)}
          </ol> : <p>Chưa có điều chỉnh.</p>}
        </section>

        {canAdjust && <form className="leave-days-form leave-days-adjust-form" onSubmit={save}>
          <h3>Điều chỉnh ngày nghỉ</h3>
          <p>Thay đổi được lưu vào danh sách ngày nghỉ và lịch sử điều chỉnh. Đề xuất gốc và chấm công giữ nguyên nội dung đã duyệt.</p>
          <fieldset disabled={busy}>
            <div className="leave-days-form-grid">
              <label>Ngày nghỉ<input type="date" required value={leaveDate} onChange={event => setLeaveDate(event.target.value)} /></label>
              <label>Lý do<select value={reason} onChange={event => setReason(event.target.value)}>{LEAVE_REASON_OPTIONS.map(option => <option key={option}>{option}</option>)}</select></label>
            </div>
            <label>Ghi chú điều chỉnh <span>(bắt buộc)</span><textarea required minLength={5} maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Ghi rõ lý do và nội dung điều chỉnh" /></label>
            <label>Tệp đi kèm<input type="file" multiple onChange={attach} /><small>Tối đa 5 tệp, mỗi tệp 2 MB; tổng dung lượng 5 MB.</small></label>
            {reading && <p role="status">Đang đọc tệp...</p>}
            {attachments.length > 0 && <ul className="leave-days-pending-files">{attachments.map((file, index) => <li key={index}>{file.name} <button type="button" className="btn" onClick={() => setAttachments(current => current.filter((_, i) => i !== index))} aria-label={`Bỏ tệp ${file.name}`}>Bỏ tệp</button></li>)}</ul>}
            <div className="leave-days-form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{saving ? 'Đang lưu...' : 'Lưu điều chỉnh'}</button></div>
          </fieldset>
        </form>}
      </>}
    </section>
  </div>
}
