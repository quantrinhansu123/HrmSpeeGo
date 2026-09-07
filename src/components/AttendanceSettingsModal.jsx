import { useEffect, useState } from 'react'
import { fbGet, fbUpdate } from '../services/firebase'
import { getCloudinaryConfig, saveCloudinaryConfig } from '../utils/cloudinary'

function AttendanceSettingsModal({ isOpen, onClose }) {
  const [standardCheckIn, setStandardCheckIn] = useState('08:30')
  const [standardCheckOut, setStandardCheckOut] = useState('17:30')
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

    fbGet('hr/attendanceSettings/default').then(settings => {
      setStandardCheckIn(settings?.standardCheckIn || '08:30')
      setStandardCheckOut(settings?.standardCheckOut || '17:30')
    }).catch(requestError => setError(requestError.message)).finally(() => setLoading(false))
  }, [isOpen])

  const submit = async event => {
    event.preventDefault()
    if (standardCheckIn >= standardCheckOut) {
      setError('Giờ Check-out chuẩn phải sau giờ Check-in chuẩn.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await fbUpdate('hr/attendanceSettings/default', { standardCheckIn, standardCheckOut, timezone: 'Asia/Ho_Chi_Minh' })
      saveCloudinaryConfig(cloudName, uploadPreset)
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
            <p style={{ marginBottom: 18, color: '#64748b' }}>Giờ chuẩn dùng để hệ thống tự tính số phút đi muộn và về sớm.</p>
            {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
            {loading ? <div style={{ padding: 24, textAlign: 'center' }}>Đang tải cài đặt...</div> : <>
              <div className="attendance-settings__grid">
                <div className="form-group"><label>Giờ Check-in chuẩn</label><input type="time" value={standardCheckIn} onChange={event => setStandardCheckIn(event.target.value)} required /></div>
                <div className="form-group"><label>Giờ Check-out chuẩn</label><input type="time" value={standardCheckOut} onChange={event => setStandardCheckOut(event.target.value)} required /></div>
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
