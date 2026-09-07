import { useEffect, useState } from 'react'
import { fbGet, fbUpdate } from '../services/firebase'
import { getCloudinaryConfig, saveCloudinaryConfig } from '../utils/cloudinary'
import {
  ATTENDANCE_SHIFT_IDS,
  buildAttendanceShiftSettingsPayload,
  getAttendanceShiftOptions,
  normalizeAttendanceShiftSettings
} from '../utils/attendanceShift'

function AttendanceSettingsModal({ isOpen, onClose, onSaved }) {
  const [settings, setSettings] = useState(() => normalizeAttendanceShiftSettings())
  const [selectedShiftId, setSelectedShiftId] = useState(ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE)
  const [cloudName, setCloudName] = useState('')
  const [uploadPreset, setUploadPreset] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setError('')
    const { cloudName: cName, uploadPreset: cPreset } = getCloudinaryConfig()
    setCloudName(cName)
    setUploadPreset(cPreset)

    fbGet('hr/attendanceSettings/default').then(storedSettings => {
      setSettings(normalizeAttendanceShiftSettings(storedSettings))
      setSelectedShiftId(ATTENDANCE_SHIFT_IDS.ADMINISTRATIVE)
    }).catch(requestError => setError(requestError.message)).finally(() => setLoading(false))
  }, [isOpen])

  const shiftOptions = getAttendanceShiftOptions(settings)
  const selectedShift = settings.shifts[selectedShiftId]
  const updateSelectedShift = (field, value) => {
    setSettings(current => ({
      ...current,
      shifts: {
        ...current.shifts,
        [selectedShiftId]: {
          ...current.shifts[selectedShiftId],
          [field]: value
        }
      }
    }))
  }

  const submit = async event => {
    event.preventDefault()
    const invalidShift = getAttendanceShiftOptions(settings).find(
      shift => shift.standardCheckIn >= shift.standardCheckOut
    )
    if (invalidShift) {
      setSelectedShiftId(invalidShift.id)
      setError(`Giờ ra chuẩn của ${invalidShift.name} phải sau giờ vào chuẩn.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await fbUpdate(
        'hr/attendanceSettings/default',
        buildAttendanceShiftSettingsPayload(settings)
      )
      saveCloudinaryConfig(cloudName, uploadPreset)
      await onSaved?.()
      onClose()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null
  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content attendance-settings" onClick={event => event.stopPropagation()}>
        <div className="modal-header"><h2>Cài đặt giờ chấm công</h2><button className="modal-close" onClick={onClose} type="button">&times;</button></div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <p style={{ marginBottom: 18, color: '#64748b' }}>Chọn từng ca để cài giờ chuẩn riêng. Báo cáo đi muộn/về sớm sẽ dùng ca của từng nhân viên.</p>
            {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
            {loading ? <div style={{ padding: 24, textAlign: 'center' }}>Đang tải cài đặt...</div> : <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {shiftOptions.map(shift => (
                  <button
                    key={shift.id}
                    className={`btn ${selectedShiftId === shift.id ? 'btn-primary' : ''}`}
                    type="button"
                    onClick={() => setSelectedShiftId(shift.id)}
                  >
                    {shift.name} ({shift.standardCheckIn}–{shift.standardCheckOut})
                  </button>
                ))}
              </div>
              <div className="attendance-settings__grid">
                <div className="form-group"><label>Giờ vào chuẩn</label><input type="time" value={selectedShift?.standardCheckIn || ''} onChange={event => updateSelectedShift('standardCheckIn', event.target.value)} required /></div>
                <div className="form-group"><label>Giờ ra chuẩn</label><input type="time" value={selectedShift?.standardCheckOut || ''} onChange={event => updateSelectedShift('standardCheckOut', event.target.value)} required /></div>
              </div>
              <h4 style={{ margin: '18px 0 8px', fontSize: '14px', color: '#1e293b' }}>Cấu hình Cloudinary (Lưu trữ ảnh xác thực)</h4>
              <div className="attendance-settings__grid">
                <div className="form-group"><label>Cloud Name</label><input type="text" placeholder="ksny3wwy" value={cloudName} onChange={event => setCloudName(event.target.value)} /></div>
                <div className="form-group"><label>Upload Preset (Unsigned)</label><input type="text" placeholder="nr5kwa0r" value={uploadPreset} onChange={event => setUploadPreset(event.target.value)} /></div>
              </div>
            </>}
          </div>
          <div className="attendance-settings__footer"><button className="btn" type="button" onClick={onClose}>Hủy</button><button className="btn btn-primary" type="submit" disabled={loading || saving}>{saving ? 'Đang lưu...' : 'Lưu cài đặt'}</button></div>
        </form>
      </div>
    </div>
  )
}

export default AttendanceSettingsModal
