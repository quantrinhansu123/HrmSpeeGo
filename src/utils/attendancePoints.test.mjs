import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import {
  isAttendancePointsMonth, pointRuleForEvent, buildAttendancePointEvents, mergeAttendancePointEvents,
  summarizeEmployeePoints, validatePointEvents, attachSavedAttendancePoints, normalizePointEvent, createManualPointEvent
} from './attendancePoints.js'
import { buildAttendanceSummary, serializeAttendanceSummaryRows, hydrateAttendanceSummaryRows } from './attendanceSummary.js'
import { applyPenaltyAmountsToSummaryRows, buildPenaltyDetailRows } from './attendancePenalties.js'
import { buildAttendanceWorkbook } from './attendanceExcel.js'

const make = (type, minutes = 0, extra = {}) => ({
  id: 'point-1', date: '2026-11-02', employeeId: 'e1', employeeName: 'A',
  eventType: type, minutes, ...pointRuleForEvent(type, minutes), reviewStatus: 'confirmed',
  note: 'HCNS xác nhận, đã kiểm tra xin phép và chứng cứ', source: 'manual', ...extra
})

test('áp dụng đúng 11/2026, không hồi tố 10/2026 hoặc chấp nhận tháng không hợp lệ', () => {
  for (const month of ['2026-10', '2026-01', '', '2026-13', '2026-00']) assert.equal(isAttendancePointsMonth(month), false)
  for (const month of ['2026-11', '2026-12', '2027-01']) assert.equal(isAttendancePointsMonth(month), true)
})
test('từng lần muộn/sớm/ra ngoài: đúng 30 và 60 trừ 20, trên 60 trừ 30', () => {
  for (const type of ['late', 'early', 'outside']) {
    for (const [minutes, points] of [[0,0], [1,10], [29,10], [30,20], [60,20], [61,30]]) {
      assert.equal(pointRuleForEvent(type, minutes).points, points, `${type}: ${minutes}`)
    }
  }
  assert.equal(pointRuleForEvent('missing_punch').points, 10)
  assert.equal(pointRuleForEvent('absence').points, 40)
  assert.equal(pointRuleForEvent('conduct').points, 10)
  assert.equal(pointRuleForEvent('emergency_leave').points, 0)
})
test('trừ ngay cả sự kiện từng chờ duyệt, miễn điểm không trừ, chưa phân nhóm không tự trả tiền', () => {
  const rows = [make('late',20), make('late',20,{id:'2',reviewStatus:'pending'}), make('missing_punch',0,{id:'3',reviewStatus:'exempt'})]
  const employee = summarizeEmployeePoints(rows, 'e1', 'employee')
  assert.equal(employee.deductedPoints, 20)
  assert.equal(employee.pendingPoints, 0)
  assert.equal(employee.pendingCount, 0)
  assert.equal(employee.remainingPoints, 80)
  assert.equal(employee.benefitAmount, 800000)
  assert.equal(summarizeEmployeePoints(rows, 'e1', 'manager').benefitAmount, 1600000)
  assert.equal(summarizeEmployeePoints([], 'e2', 'employee').remainingPoints, 100)
  assert.equal(summarizeEmployeePoints([], 'e2').benefitAmount, null)
  assert.equal(summarizeEmployeePoints(rows, 'e1', 'ineligible').benefitAmount, 0)
})
test('tổng trừ 120 giữ lịch sử 120, còn 0; ngưỡng kỷ luật chỉ là cảnh báo riêng', () => {
  const rows = [1,2,3].map(day => make('absence', 0, { id:String(day), date:`2026-11-0${day}` }))
  const summary = summarizeEmployeePoints(rows, 'e1', 'manager')
  assert.equal(summary.deductedPoints,120)
  assert.equal(summary.remainingPoints,0)
  assert.equal(summary.benefitAmount,0)
  assert.equal(summary.needsDisciplineReview,true)
  const repeated = [1,2,3,4].map(day => make('late',1,{id:String(day),date:`2026-11-0${day}`}))
  assert.equal(summarizeEmployeePoints(repeated,'e1').needsDisciplineReview,true)
  repeated[0].reviewStatus='exempt'
  assert.equal(summarizeEmployeePoints(repeated,'e1').needsDisciplineReview,false)
})
test('bỏ miễn hai lần nhỏ và giữ từng sự kiện độc lập trong tháng mới', () => {
  const rows = [{ employeeId:'e1', month:'2026-11', days: {
    '2026-11-02': {late:true,lateMinutes:10,early:true,earlyMinutes:10,lateEarlyApproved:true},
    '2026-11-03': {late:true,lateMinutes:10,missingPunch:true,unapprovedAbsence:true}
  }}]
  const events = buildPenaltyDetailRows(rows)
  assert.equal(events.length,5)
  assert.equal(events.filter(row=>row.eventType==='late').length,2)
  assert.ok(events.every(row=>row.reviewStatus==='confirmed' && row.amount===0))
  assert.match(events[0].note,/đã duyệt/)
  const [summary] = applyPenaltyAmountsToSummaryRows(rows)
  assert.equal(summary.totalFine,0)
  assert.equal(summary.lateFine,0)
  assert.equal(buildAttendancePointEvents([{...rows[0],days:{'2026-10-02':{late:true,lateMinutes:20}}}]).length,0)
})
test('snapshot giữ từng lượt trong cùng ngày, không chọn mức điểm theo tổng phút ngày', () => {
  const summary = buildAttendanceSummary({ month:'2026-11', employees:[{id:'e1',name:'A'}], attendanceLogs:[
    {id:'l1',employeeId:'e1',date:'2026-11-02',calculationMode:'source-value',lateMinutes:20,cong:0.5},
    {id:'l2',employeeId:'e1',date:'2026-11-02',calculationMode:'source-value',lateMinutes:20,cong:0.5}
  ]})
  const restored = hydrateAttendanceSummaryRows(serializeAttendanceSummaryRows(summary))
  const events = buildAttendancePointEvents(restored)
  assert.equal(events.length,2)
  assert.ok(events.every(event=>event.points===10 && event.minutes===20))
  assert.equal(new Set(events.map(event=>event.id)).size,2)
})
test('tổng hợp lại giữ miễn và ghi chú, đổi thời lượng áp dụng ngay điểm mới', () => {
  const initial = buildAttendancePointEvents([{employeeId:'e1',days:{'2026-11-02':{late:true,lateMinutes:20}}}])
  const reviewed = initial.map(row=>({...row,reviewStatus:'exempt',note:'Đã báo đúng hạn'}))
  const manual = make('conduct',0,{id:'manual'})
  const same = mergeAttendancePointEvents([...reviewed,manual],initial)
  assert.equal(same.length,2)
  assert.equal(same.find(row=>row.source==='auto').reviewStatus,'exempt')
  assert.equal(same.find(row=>row.source==='auto').note,'Đã báo đúng hạn')
  const changed=mergeAttendancePointEvents(reviewed,[{...initial[0],minutes:29}])
  assert.equal(changed[0].reviewStatus,'confirmed')
  assert.match(changed[0].note,/thay đổi/)
  assert.deepEqual(mergeAttendancePointEvents([...reviewed,manual],[]).map(row=>row.id),['manual'])
})
test('không cần ghi nhận để trừ ngay; miễn cần lý do; kiểm tra ngày, điểm, số lần nghỉ và giải trình', () => {
  assert.doesNotThrow(()=>validatePointEvents('2026-11',[make('late',30)]))
  assert.doesNotThrow(()=>validatePointEvents('2026-11',[make('late',30,{note:''})]))
  for(const patch of [{date:'2026-10-02'},{date:'2026-11-31'},{date:''},{points:50000},{minutes:-1},{minutes:1.5},{reviewStatus:'exempt',note:''},{employeeId:''}]) {
    assert.throws(()=>validatePointEvents('2026-11',[make('late',30,patch)]))
  }
  assert.throws(()=>validatePointEvents('2026-11',[make('absence'),make('absence',0,{id:'other'})]),/một lần/)
  const exemptions = [1,2,3].map(day=>make('missing_punch',0,{id:String(day),date:`2026-11-0${day}`,reviewStatus:'exempt'}))
  assert.throws(()=>validatePointEvents('2026-11',exemptions),/2 lần/)
  assert.doesNotThrow(()=>validatePointEvents('2026-11',exemptions.slice(0,2)))
})
test('Excel tháng mới chỉ xuất điểm đã lưu và dữ liệu kiểm tra, không có công thức tiền phạt khi mở lại', async () => {
  const rows = attachSavedAttendancePoints([{employeeId:'e1',employeeName:'A',workdays:1,days:new Map()}],
    [make('late',20),make('early',20,{id:'other',reviewStatus:'pending'})],{e1:'employee'})
  const workbook = await buildAttendanceWorkbook(null,rows,'2026-11')
  const buffer = await workbook.xlsx.writeBuffer()
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(buffer)
  const sheet = reopened.getWorksheet('Chuyên cần theo điểm')
  assert.equal(sheet.getCell('F2').value,20)
  assert.equal(sheet.getCell('G2').value,80)
  assert.equal(sheet.getCell('J2').value,800000)
  assert.ok(!sheet.getRow(1).values.some(value=>String(value).includes('chờ kiểm tra')))
  assert.equal(reopened.getWorksheet('Ghi nhận HCNS').rowCount,3)
  for (const worksheet of reopened.worksheets) worksheet.eachRow(row=>row.eachCell(cell=>{
    assert.notEqual(cell.type,ExcelJS.ValueType.Formula)
  }))
})

test('sự kiện tự động và nhập tay trừ ngay, không cần ghi chú hay duyệt', () => {
  const events = buildAttendancePointEvents([{employeeId:'e1',days:{'2026-11-02':{late:true,lateMinutes:20}}}])
  assert.equal(events[0].reviewStatus, 'confirmed')
  assert.equal(summarizeEmployeePoints(events,'e1').remainingPoints,90)
  assert.doesNotThrow(()=>validatePointEvents('2026-11',events))
  assert.equal(createManualPointEvent('2026-11').reviewStatus, 'confirmed')
  assert.equal(normalizePointEvent({reviewStatus:'pending'}).reviewStatus, 'confirmed')
})

test('mức admin chỉnh giữ nguyên khi nạp lại và đổi phút; chỉ điểm nguyên từ 0 đến 100', () => {
  const initial = buildAttendancePointEvents([{employeeId:'e1',days:{'2026-11-02':{late:true,lateMinutes:20}}}])
  const adjusted = [{...initial[0],points:5,pointsOverridden:true,note:'Admin chỉnh'}]
  for (const generated of [initial, [{...initial[0],minutes:60,...pointRuleForEvent('late',60)}]]) {
    const merged = mergeAttendancePointEvents(adjusted,generated)
    assert.equal(merged[0].points,5)
    assert.equal(merged[0].pointsOverridden,true)
    assert.equal(summarizeEmployeePoints(merged,'e1','employee').benefitAmount,950000)
    assert.doesNotThrow(()=>validatePointEvents('2026-11',merged))
  }
  for (const points of [0,5,100]) assert.doesNotThrow(()=>validatePointEvents('2026-11',[make('late',20,{points,pointsOverridden:true,note:''})]))
  for (const points of [-1,101,1.5,NaN,Infinity,'']) assert.throws(()=>validatePointEvents('2026-11',[normalizePointEvent(make('late',20,{points,pointsOverridden:true}))]))
  assert.throws(()=>validatePointEvents('2026-11',[make('late',20,{points:5})]))
})
