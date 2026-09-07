import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import {
  buildAttendanceSummary,
  serializeAttendanceSummaryRows
} from '../src/utils/attendanceSummary.js'
import { mapUserToApp } from '../src/utils/helpers.js'

const envContent = fs.readFileSync('.env.local', 'utf8')
const getEnv = (key) => {
  const m = envContent.match(new RegExp(`${key}=["']?([^"'\r\n]+)`))
  return m ? m[1] : null
}
const supabase = createClient(getEnv('VITE_SUPABASE_URL'), getEnv('VITE_SUPABASE_ANON_KEY'))

async function syncAugustSummary() {
  console.log('Logging in as admin...')
  await supabase.auth.signInWithPassword({ email: 'admin@company.local', password: '123456' })

  // 1. Fetch employees
  const { data: rawUsers, error: userErr } = await supabase.from('users').select('*')
  if (userErr) throw userErr
  const employees = rawUsers.map(u => ({ ...mapUserToApp(u), id: u.id }))
  console.log(`Loaded ${employees.length} employees`)

  // 2. Fetch logs for 2026-08
  const { data: rawLogs, error: logErr } = await supabase
    .from('hr_records')
    .select('id, data')
    .eq('collection', 'attendanceLogs')
    .gte('data->>date', '2026-08-01')
    .lte('data->>date', '2026-08-31')
  if (logErr) throw logErr

  const logs = rawLogs.map(r => ({ ...r.data, id: r.id.replace('attendanceLogs::', '') }))
  console.log(`Loaded ${logs.length} logs for 2026-08`)

  // 3. Fetch adjustments & manuals for 2026-08
  const { data: rawAdj } = await supabase
    .from('hr_records')
    .select('data')
    .eq('id', 'attendanceAdjustments::2026-08')
    .maybeSingle()
  const adjustments = rawAdj?.data || {}

  const { data: rawManuals } = await supabase
    .from('hr_records')
    .select('id, data')
    .eq('collection', 'manualWorkdays')
    .like('id', 'manualWorkdays::2026-08__%')
  const manuals = {}
  ;(rawManuals || []).forEach(r => {
    const empId = r.id.replace('manualWorkdays::2026-08__', '')
    if (empId) manuals[empId] = r.data || {}
  })

  // 4. Generate summary
  const targetMonth = '2026-08'
  const summaryRows = buildAttendanceSummary({
    attendanceLogs: logs,
    employees,
    month: targetMonth,
    attendanceAdjustments: adjustments,
    manualWorkdays: manuals
  })

  console.log(`Calculated summary for ${summaryRows.length} rows`)

  const snapshot = {
    month: targetMonth,
    generatedAt: new Date().toISOString(),
    sourceLogCount: logs.length,
    employeeCount: summaryRows.length,
    rows: serializeAttendanceSummaryRows(summaryRows)
  }

  // 5. Update attendanceMonthSummaries::2026-08 in Supabase
  const recordId = `attendanceMonthSummaries::${targetMonth}`
  const { error: upsertErr } = await supabase.from('hr_records').upsert(
    {
      id: recordId,
      collection: 'attendanceMonthSummaries',
      data: snapshot,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'id' }
  )

  if (upsertErr) {
    console.error('Error updating snapshot:', upsertErr)
    throw upsertErr
  }

  console.log(`Successfully updated ${recordId} in Supabase!`)
  console.log('Sample rows:')
  summaryRows.slice(0, 5).forEach((r, i) => {
    console.log(`- ${r.employeeCode || '-'} | ${r.employeeName} | Công: ${r.workdays} | Muộn: ${r.lateCount}`)
  })
}

syncAugustSummary().catch(console.error)
