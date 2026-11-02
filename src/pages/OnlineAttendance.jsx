import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import { fbGet, fbUpdate } from '../services/firebase'
import { rebuildAttendanceMonthSummaryForDate } from '../services/attendanceMonthSummary'
import { getCompanyIdForUser, getCompanyNameForContext } from '../utils/companyContext'
import { uploadToCloudinary } from '../utils/cloudinary'
import {
  normalizeAttendanceShiftSettings,
  resolveAttendanceShift
} from '../utils/attendanceShift'
import './OnlineAttendance.css'

const getTime = value => {
  if (!value) return '—'
  const direct = String(value).match(/^(\d{1,2}):(\d{2})/)
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
}

const buildMapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`

const requestPosition = options =>
  new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({ error: 'unsupported' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const lat = Number(position.coords.latitude)
        const lng = Number(position.coords.longitude)
        resolve({
          lat,
          lng,
          accuracy: Number(position.coords.accuracy) || null,
          at: new Date().toISOString(),
          mapsUrl: buildMapsUrl(lat, lng)
        })
      },
      err => {
        const code = err?.code
        resolve({
          error: code === 1 ? 'denied' : code === 2 ? 'unavailable' : code === 3 ? 'timeout' : 'failed',
          message: err?.message || ''
        })
      },
      options
    )
  })

// Máy tính thường không có GPS: thử độ chính xác cao trước, sau đó dùng vị trí theo Wi-Fi/IP của trình duyệt.
const captureGeolocation = async () => {
  const precise = await requestPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
  if (!precise.error || precise.error === 'denied' || precise.error === 'unsupported') return precise
  const coarse = await requestPosition({ enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 })
  return coarse.error ? precise : coarse
}

// Đổi toạ độ thành địa chỉ đọc được (OpenStreetMap Nominatim); lỗi mạng thì bỏ qua.
const reverseGeocode = async (lat, lng) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=vi&lat=${lat}&lon=${lng}`,
      { signal: controller.signal }
    )
    if (!response.ok) return ''
    const data = await response.json()
    return String(data?.display_name || '')
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

const describeDevice = () => {
  const ua = navigator.userAgent || ''
  const isMobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(ua)
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt khác'
  const platform = navigator.userAgentData?.platform || navigator.platform || ''
  return `${isMobile ? 'Điện thoại' : 'Máy tính'} · ${platform} · ${browser}`
}

const formatLocationLabel = location => {
  if (!location) return '—'
  if (location.error) {
    if (location.error === 'denied') return 'Không có vị trí (bị từ chối)'
    if (location.error === 'unsupported') return 'Thiết bị không hỗ trợ GPS'
    if (location.error === 'timeout') return 'Hết thời gian lấy vị trí'
    return 'Không lấy được vị trí'
  }
  if (location.lat == null || location.lng == null) return '—'
  if (location.address) return location.address
  const lat = Number(location.lat).toFixed(5)
  const lng = Number(location.lng).toFixed(5)
  return `${lat}, ${lng}`
}

function OnlineAttendance() {
  const { user } = useAuth()
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'hr' || user?.role === 'manager'
  const [today, setToday] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 1. Đồng hồ thời gian thực
  const [currentTime, setCurrentTime] = useState(new Date())

  // 2. Chụp ảnh & Tải ảnh Cloudinary
  const [photoPreview, setPhotoPreview] = useState(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  // 3. Cài đặt ca làm việc
  const [attendanceSettings, setAttendanceSettings] = useState(() => normalizeAttendanceShiftSettings())

  // 4. Định vị GPS
  const [liveLocation, setLiveLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState('idle') // idle | loading | ready | error

  const refreshLiveLocation = useCallback(async () => {
    setLocationStatus('loading')
    const result = await captureGeolocation()
    setLiveLocation(result)
    setLocationStatus(result.error ? 'error' : 'ready')
    return result
  }, [])

  useEffect(() => {
    refreshLiveLocation()
  }, [refreshLiveLocation])

  // Cập nhật đồng hồ mỗi giây
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Tải cài đặt ca và Cloudinary ban đầu
  useEffect(() => {
    fbGet('hr/attendanceSettings/default')
      .then(settings => {
        const normalized = normalizeAttendanceShiftSettings(settings)
        setAttendanceSettings(normalized)
      })
      .catch(() => {})

  }, [])

  // Camera management
  const startCamera = async () => {
    setIsCameraActive(true)
    setPhotoPreview(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      setError(`Không thể bật camera: ${err.message}`)
      setIsCameraActive(false)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsCameraActive(false)
  }

  const capturePhoto = () => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth || 640
    canvas.height = videoRef.current.videoHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setPhotoPreview(dataUrl)
    stopCamera()
  }

  // Tải dữ liệu chấm công hôm nay
  const loadToday = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: requestError } = await supabase.rpc('get_online_attendance_today')
    if (requestError) {
      setError(requestError.message)
    } else {
      setToday(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadToday()
  }, [loadToday])

  const record = today?.record || null
  const checkedIn = Boolean(record?.checkIn || record?.vao)
  const checkedOut = Boolean(record?.checkOut || record?.ra)
  const userShift = useMemo(
    () => resolveAttendanceShift(user, record || {}, attendanceSettings),
    [attendanceSettings, record, user]
  )
  const standardIn = userShift.start
  const standardOut = userShift.end

  // Tính số phút đi muộn / về sớm thời gian thực
  const calcTimingStatus = () => {
    const [stdInHour, stdInMin] = (standardIn || '08:30').split(':').map(Number)
    const [stdOutHour, stdOutMin] = (standardOut || '17:30').split(':').map(Number)

    // Nếu đã check-in
    let checkInStatus = null
    if (checkedIn) {
      const vaoStr = record?.vao || ''
      const [vH, vM] = vaoStr.split(':').map(Number)
      if (!Number.isNaN(vH) && !Number.isNaN(vM)) {
        const diffMinutes = (vH * 60 + vM) - (stdInHour * 60 + stdInMin)
        if (diffMinutes > 0) {
          checkInStatus = { isLate: true, text: `Đi muộn ${diffMinutes} phút`, class: 'badge-danger' }
        } else {
          checkInStatus = { isLate: false, text: diffMinutes === 0 ? 'Đúng giờ' : `Đúng giờ (Sớm ${Math.abs(diffMinutes)}p)`, class: 'badge-success' }
        }
      }
    } else {
      // Chưa check-in -> so sánh thời gian hiện tại
      const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes()
      const stdInMinutes = stdInHour * 60 + stdInMin
      if (nowMinutes > stdInMinutes) {
        checkInStatus = { isLate: true, text: `Muộn ${nowMinutes - stdInMinutes}p nếu check-in lúc này`, class: 'badge-warning' }
      } else {
        checkInStatus = { isLate: false, text: 'Check-in đúng giờ', class: 'badge-success' }
      }
    }

    // Check-out status
    let checkOutStatus = null
    if (checkedOut) {
      const raStr = record?.ra || ''
      const [rH, rM] = raStr.split(':').map(Number)
      if (!Number.isNaN(rH) && !Number.isNaN(rM)) {
        const diffMinutes = (rH * 60 + rM) - (stdOutHour * 60 + stdOutMin)
        if (diffMinutes < 0) {
          checkOutStatus = { isEarly: true, text: `Về sớm ${Math.abs(diffMinutes)} phút`, class: 'badge-warning' }
        } else if (diffMinutes > 0) {
          checkOutStatus = { isEarly: false, text: `Đúng giờ (Tăng ca ${diffMinutes}p)`, class: 'badge-success' }
        } else {
          checkOutStatus = { isEarly: false, text: 'Đúng giờ', class: 'badge-success' }
        }
      }
    }

    return { checkInStatus, checkOutStatus }
  }

  const { checkInStatus, checkOutStatus } = calcTimingStatus()

  // Nộp chấm công (Check-in hoặc Check-out)
  const submit = async action => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    setNotice('')

    try {
      // 1. Upload ảnh lên Cloudinary nếu có ảnh
      let uploadedPhotoUrl = ''
      if (photoPreview) {
        uploadedPhotoUrl = await uploadToCloudinary(photoPreview)
      }

      // 2a. Lấy vị trí tại thời điểm chấm công (không chặn chấm công nếu thiếu vị trí)
      const capturedLocation = await captureGeolocation()
      setLiveLocation(capturedLocation)
      setLocationStatus(capturedLocation.error ? 'error' : 'ready')
      if (!capturedLocation.error) {
        capturedLocation.address = await reverseGeocode(capturedLocation.lat, capturedLocation.lng)
      }
      capturedLocation.device = describeDevice()

      // 2. Gọi RPC chấm công của hệ thống
      const functionName = action === 'in' ? 'employee_online_check_in' : 'employee_online_check_out'
      const { data, error: requestError } = await supabase.rpc(functionName)

      if (requestError) {
        throw new Error(requestError.message)
      }

      // 3. Cập nhật thêm ảnh Cloudinary và vị trí vào bản ghi
      try {
        const recordDate = data?.date || new Date().toISOString().slice(0, 10)
        const recordId = data?.record?.id || `online_${user.id || user.auth_user_id}_${recordDate.replace(/-/g, '')}`
        const prefix = action === 'in' ? 'checkIn' : 'checkOut'
        const patch = { [`${prefix}Location`]: capturedLocation }
        if (uploadedPhotoUrl) patch[`${prefix}Photo`] = uploadedPhotoUrl
        await fbUpdate(`hr/attendanceLogs/${recordId}`, patch)
      } catch (updateErr) {
        console.warn('Lưu ảnh/vị trí phụ:', updateErr.message)
      }

      // 4. Cập nhật state giao diện
      setToday(current => ({
        ...current,
        ...data,
        record: {
          ...(current?.record || {}),
          ...(data?.record || {}),
          [action === 'in' ? 'checkInPhoto' : 'checkOutPhoto']: uploadedPhotoUrl,
          [action === 'in' ? 'checkInLocation' : 'checkOutLocation']: capturedLocation
        }
      }))

      setPhotoPreview(null)
      stopCamera()
      setNotice(action === 'in' ? '✓ Check-in thành công!' : '✓ Check-out thành công!')

      // Đồng bộ vào bảng công tháng (attendanceMonthSummaries) để /bang-cong-preview thấy ngay.
      const recordDate = data?.date || data?.record?.date || new Date().toISOString().slice(0, 10)
      try {
        await rebuildAttendanceMonthSummaryForDate(recordDate, {
          companyId: getCompanyIdForUser(user),
          companyName: getCompanyNameForContext({ name: 'SpeeGo Logistics' }, user)
        })
      } catch (syncError) {
        console.warn('Đã chấm công nhưng chưa đồng bộ bảng công tháng:', syncError)
        setNotice(previous =>
          `${previous || ''} Chưa cập nhật được bảng công tổng hợp — bấm “Tổng hợp lại” trên Bảng công.`
        )
      }
    } catch (err) {
      setError(err.message || 'Lỗi khi chấm công')
    } finally {
      setSubmitting(false)
    }
  }

  const hoursStr = String(currentTime.getHours()).padStart(2, '0')
  const minutesStr = String(currentTime.getMinutes()).padStart(2, '0')
  const secondsStr = String(currentTime.getSeconds()).padStart(2, '0')
  const dayOfWeekNames = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
  const dateFormatted = `${dayOfWeekNames[currentTime.getDay()]}, ${currentTime.getDate().toString().padStart(2, '0')}/${(currentTime.getMonth() + 1).toString().padStart(2, '0')}/${currentTime.getFullYear()}`

  return (
    <div className="online-attendance-v2">
      {/* Header */}
      <div className="oa-header">
        <div>
          <h1>Chấm công online</h1>
          <p className="oa-subtitle">
            {user.ho_va_ten || user.name || user.email} · {dateFormatted}
          </p>
        </div>
        <div className="oa-header-actions">
          <Link className="oa-btn-view oa-btn-view--ghost" to="/lich-su-cham-cong">
            <i className="fas fa-clock-rotate-left" aria-hidden="true"></i> Lịch sử chấm công
          </Link>
          <Link className="oa-btn-view" to={isAdminOrManager ? '/bang-cong-preview' : '/bang-cong'}>
            <i className="fas fa-calendar-check" aria-hidden="true"></i> Xem bảng công
          </Link>
        </div>
      </div>

      {/* Hero: Đồng hồ thời gian thực */}
      <div className="oa-dashboard-grid">
        <div className="oa-clock-card">
          <div className="oa-card-label">ĐỒNG HỒ HỆ THỐNG (GIỜ VIỆT NAM)</div>
          <div className="oa-digital-clock">
            <span className="oa-digit">{hoursStr}</span>
            <span className="oa-colon">:</span>
            <span className="oa-digit">{minutesStr}</span>
            <span className="oa-colon">:</span>
            <span className="oa-digit oa-seconds">{secondsStr}</span>
          </div>
          <div className="oa-clock-date">{dateFormatted}</div>
          <div className="oa-shift-badge">
            Ca làm việc: <strong>{standardIn} - {standardOut}</strong>
          </div>
        </div>
        <div className="oa-location-card">
          <div className="oa-card-label">VỊ TRÍ CHẤM CÔNG</div>
          {locationStatus === 'loading' && <div className="oa-loc-status is-loading">Đang xác định vị trí…</div>}
          {locationStatus === 'error' && (
            <div className="oa-loc-status is-error">
              {formatLocationLabel(liveLocation)}. Hãy cho phép trình duyệt truy cập vị trí để Admin kiểm tra.
            </div>
          )}
          {locationStatus === 'ready' && liveLocation && (
            <div className="oa-loc-info">
              <div className="oa-loc-coords">
                <a className="oa-loc-link" href={liveLocation.mapsUrl} target="_blank" rel="noreferrer" title="Mở Google Maps">
                  {Number(liveLocation.lat).toFixed(5)}, {Number(liveLocation.lng).toFixed(5)}
                </a>
              </div>
              {liveLocation.accuracy != null && (
                <div className="oa-loc-accuracy">Độ chính xác ±{Math.round(liveLocation.accuracy)}m</div>
              )}
            </div>
          )}
          <small className="oa-loc-device">Thiết bị: {describeDevice()}. Vị trí được lưu khi bạn Check-in / Check-out.</small>
          <button type="button" className="oa-btn-refresh-loc" onClick={refreshLiveLocation} disabled={locationStatus === 'loading'}>
            Lấy lại vị trí
          </button>
        </div>
      </div>

      {/* Thông báo thông điệp */}
      {error && <div className="oa-alert oa-alert-danger">{error}</div>}
      {notice && <div className="oa-alert oa-alert-success">{notice}</div>}

      {/* Trạng thái 2 cổng: Check-in & Check-out */}
      <div className="oa-punches-grid">
        {/* Cột Check-in */}
        <div className={`oa-punch-box ${checkedIn ? 'is-done' : 'is-pending'}`}>
          <div className="oa-punch-header">
            <span>GIỜ VÀO (CHECK-IN)</span>
            <span className="oa-req-time">Chuẩn: {standardIn}</span>
          </div>
          <div className="oa-punch-time">
            {checkedIn ? getTime(record?.vao || record?.checkIn) : 'Chưa chấm'}
          </div>
          <div className="oa-punch-status">
            {checkInStatus && (
              <span className={`oa-badge ${checkInStatus.class}`}>{checkInStatus.text}</span>
            )}
          </div>
          {record?.checkInPhoto && (
            <div className="oa-punch-photo-preview">
              <img src={record.checkInPhoto} alt="Ảnh Check-in" />
              <small>Ảnh xác thực check-in (Cloudinary)</small>
            </div>
          )}
        </div>

        {/* Cột Check-out */}
        <div className={`oa-punch-box ${checkedOut ? 'is-done' : checkedIn ? 'is-active' : 'is-pending'}`}>
          <div className="oa-punch-header">
            <span>GIỜ RA (CHECK-OUT)</span>
            <span className="oa-req-time">Chuẩn: {standardOut}</span>
          </div>
          <div className="oa-punch-time">
            {checkedOut ? getTime(record?.ra || record?.checkOut) : 'Chưa check-out'}
          </div>
          <div className="oa-punch-status">
            {checkOutStatus ? (
              <span className={`oa-badge ${checkOutStatus.class}`}>{checkOutStatus.text}</span>
            ) : (
              <span className="oa-badge badge-neutral">Chờ hoàn thành ca</span>
            )}
          </div>
          {record?.checkOutPhoto && (
            <div className="oa-punch-photo-preview">
              <img src={record.checkOutPhoto} alt="Ảnh Check-out" />
              <small>Ảnh xác thực check-out (Cloudinary)</small>
            </div>
          )}
        </div>
      </div>

      {/* Khu vực Tải / Chụp ảnh & Nút hành động */}
      {(!checkedIn || (checkedIn && !checkedOut)) && (
        <div className="oa-action-card">
          <h3>
            Xác thực chấm công {!checkedIn ? 'Check-in (Giờ vào)' : 'Check-out (Giờ ra)'}
          </h3>
          <p className="oa-action-desc">
            Chụp hoặc tải ảnh selfie/khuôn mặt để lưu trữ xác thực trên Cloudinary.
          </p>

          {/* Camera Viewfinder */}
          {isCameraActive && (
            <div className="oa-camera-container">
              <video ref={videoRef} autoPlay playsInline muted className="oa-video-feed" />
              <div className="oa-camera-controls">
                <button type="button" className="oa-btn-capture" onClick={capturePhoto}>
                  📸 Chụp ảnh ngay
                </button>
                <button type="button" className="oa-btn-cancel-cam" onClick={stopCamera}>
                  Đóng camera
                </button>
              </div>
            </div>
          )}

          {/* Photo Preview */}
          {photoPreview && (
            <div className="oa-preview-container">
              <img src={photoPreview} alt="Ảnh xác thực" className="oa-captured-image" />
              <div className="oa-preview-actions">
                <button type="button" className="oa-btn-retake" onClick={() => setPhotoPreview(null)}>
                  ✕ Bỏ ảnh / Chụp lại
                </button>
                <span className="oa-photo-ok">✓ Ảnh đã sẵn sàng tải lên Cloudinary</span>
              </div>
            </div>
          )}

          {/* Nút chụp ảnh hoặc upload */}
          {!isCameraActive && !photoPreview && (
            <div className="oa-photo-sources">
              <button type="button" className="oa-btn-open-cam" onClick={startCamera}>
                🎥 Bật Camera máy tính
              </button>
            </div>
          )}

          {/* Nút nộp Check-in / Check-out */}
          <div className="oa-submit-bar">
            {!checkedIn && (
              <button
                type="button"
                className="oa-btn-submit oa-btn-checkin"
                disabled={submitting}
                onClick={() => submit('in')}
              >
                {submitting ? 'Đang gửi dữ liệu & tải ảnh...' : 'XÁC NHẬN CHECK-IN'}
              </button>
            )}

            {checkedIn && !checkedOut && (
              <button
                type="button"
                className="oa-btn-submit oa-btn-checkout"
                disabled={submitting}
                onClick={() => submit('out')}
              >
                {submitting ? 'Đang gửi dữ liệu & tải ảnh...' : 'XÁC NHẬN CHECK-OUT'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Đã xong cả ngày */}
      {checkedIn && checkedOut && (
        <div className="oa-completed-card">
          <div className="oa-done-icon">✓</div>
          <h3>Bạn đã hoàn thành chấm công ngày hôm nay!</h3>
          <p>
            Vào: <strong>{getTime(record?.vao || record?.checkIn)}</strong> · Ra:{' '}
            <strong>{getTime(record?.ra || record?.checkOut)}</strong> · Tổng giờ:{' '}
            <strong>{record?.hours || record?.gio || 0} giờ</strong>
          </p>
        </div>
      )}
    </div>
  )
}

export default OnlineAttendance
