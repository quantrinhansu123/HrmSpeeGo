import ExcelJS from 'exceljs'
import { ATTENDANCE_POINT_TYPES, summarizeEmployeePoints } from './attendancePoints.js'

// Báo cáo điểm dùng workbook riêng: không để lại các công thức tiền phạt của mẫu cũ.
export const buildAttendancePointWorkbook = (rows, month) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Chuyên cần theo điểm')
  sheet.columns = [
    { header: 'Mã NV', key: 'employeeCode', width: 16 },
    { header: 'Họ tên', key: 'employeeName', width: 28 },
    { header: 'Bộ phận', key: 'department', width: 22 },
    { header: 'Tổng công', key: 'workdays', width: 14 },
    { header: 'Điểm đầu tháng', key: 'initial', width: 18 },
    { header: 'Điểm đã trừ', key: 'deducted', width: 24 },
    { header: 'Điểm còn lại', key: 'remaining', width: 18 },
    { header: 'Tỷ lệ hưởng (%)', key: 'rate', width: 18 },
    { header: 'Phúc lợi tối đa (đ)', key: 'maximum', width: 24 },
    { header: 'Phúc lợi dự kiến (đ)', key: 'benefit', width: 24 },
    { header: 'Trạng thái', key: 'status', width: 32 }
  ]
  rows.forEach(row => {
    const points = row.attendancePoints || summarizeEmployeePoints(row.pointEvents || [], row.employeeId)
    sheet.addRow({
      employeeCode: row.employeeCode || '', employeeName: row.employeeName || '', department: row.department || '',
      workdays: row.workdays ?? null, initial: 100, deducted: points.deductedPoints,
      remaining: points.remainingPoints, rate: points.remainingPoints,
      maximum: points.maximum, benefit: points.benefitAmount,
      status: points.maximum === null ? 'Chưa xác định nhóm hưởng' : 'Áp dụng điểm trừ ngay'
    })
  })
  const events = workbook.addWorksheet('Ghi nhận HCNS')
  events.columns = [
    { header: 'Ngày', key: 'date', width: 14 }, { header: 'Mã NV', key: 'code', width: 16 },
    { header: 'Họ tên', key: 'name', width: 28 }, { header: 'Hành vi', key: 'type', width: 52 },
    { header: 'Số phút', key: 'minutes', width: 12 }, { header: 'Điểm trừ', key: 'points', width: 22 },
    { header: 'Admin đã chỉnh điểm', key: 'adjusted', width: 22 },
    { header: 'Kết quả', key: 'status', width: 22 }, { header: 'Ghi nhận / lý do HCNS', key: 'note', width: 55 }
  ]
  const seen = new Set()
  rows.forEach(row => (row.pointEvents || []).forEach(event => {
    if (seen.has(event.id)) return
    seen.add(event.id)
    events.addRow({ date: event.date, code: event.employeeCode, name: event.employeeName,
      type: ATTENDANCE_POINT_TYPES.find(type => type.key === event.eventType)?.label || event.eventType,
      minutes: event.minutes, points: event.points, adjusted: event.pointsOverridden ? 'Có' : '',
      status: event.reviewStatus === 'exempt' ? 'Miễn điểm' : 'Áp dụng trừ điểm', note: event.note })
  }))
  // Giữ dữ liệu chấm công trong báo cáo xuất từ trang Bảng công.
  const attendance = workbook.addWorksheet('Công theo ngày')
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(year, monthNumber, 0).getDate()
  attendance.addRow(['Mã NV', 'Họ tên', 'Tổng công', ...Array.from({ length: dayCount }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)])
  rows.forEach(row => attendance.addRow([row.employeeCode || '', row.employeeName || '', row.workdays ?? null,
    ...Array.from({ length: dayCount }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`
      const day = row.days instanceof Map ? row.days.get(date) : row.days?.[date]
      return day?.workdaysExact ?? day?.workdays ?? null
    })]))
  for (const worksheet of workbook.worksheets) {
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D427A' } }
    worksheet.getRow(1).height = 35
    worksheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' }
    worksheet.views = [{ state: 'frozen', ySplit: 1 }]
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, worksheet.rowCount), column: worksheet.columnCount } }
    worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  }
  attendance.getColumn(1).width = 16
  attendance.getColumn(2).width = 28
  sheet.getColumn('workdays').numFmt = '0.00'
  sheet.getColumn('maximum').numFmt = '#,##0'
  sheet.getColumn('benefit').numFmt = '#,##0'
  workbook.subject = `Chuyên cần tháng ${month}; phúc lợi ngoài lương, số dự kiến; không phải tiền phạt.`
  return workbook
}

export const downloadPointWorkbook = async (workbook, fileName) => {
  const output = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = fileName
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  URL.revokeObjectURL(url)
}
export const downloadAttendancePointsReport = (rows, month) => downloadPointWorkbook(buildAttendancePointWorkbook(rows, month), `CHUYEN_CAN_${month}.xlsx`)
