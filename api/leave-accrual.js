import { timingSafeEqual } from 'node:crypto'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const secret = process.env.CRON_SECRET
  const supplied = Buffer.from(req.headers.authorization || '')
  const expected = Buffer.from(`Bearer ${secret || ''}`)
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(503).json({ error: 'Leave scheduler is not configured' })
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/run_monthly_leave_accrual`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(50000)
    })
    if (!response.ok) return res.status(502).json({ error: 'Leave reconciliation failed; retry the scheduled task' })
    return res.status(200).json({ updatedPeriods: await response.json() })
  } catch {
    return res.status(502).json({ error: 'Leave reconciliation could not reach the database' })
  }
}
