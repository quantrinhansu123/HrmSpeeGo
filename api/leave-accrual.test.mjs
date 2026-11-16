import test from 'node:test'
import assert from 'node:assert/strict'
import handler from './leave-accrual.js'

test('scheduler authenticates before contacting the database and does not expose service credentials', async () => {
  const previous = { ...process.env }
  const originalFetch = globalThis.fetch
  let calls = 0
  try {
    process.env.CRON_SECRET = 'local-cron-test'
    process.env.SUPABASE_URL = 'https://test.invalid'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-service-test'
    globalThis.fetch = async (url, options) => {
      calls++
      assert.equal(url, 'https://test.invalid/rest/v1/rpc/run_monthly_leave_accrual')
      assert.equal(options.headers.Authorization, 'Bearer local-service-test')
      return { ok: true, json: async () => 3 }
    }
    const run = async request => {
      const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
      await handler(request, res)
      return res
    }
    assert.equal((await run({ method: 'POST', headers: {} })).code, 405)
    assert.equal((await run({ method: 'GET', headers: {} })).code, 401)
    assert.equal((await run({ method: 'GET', headers: { authorization: 'Bearer wrong' } })).code, 401)
    assert.equal(calls, 0)
    const result = await run({ method: 'GET', headers: { authorization: 'Bearer local-cron-test' } })
    assert.equal(result.code, 200)
    assert.deepEqual(result.body, { updatedPeriods: 3 })
    globalThis.fetch = async () => { throw new Error('private-service-error') }
    const failed = await run({ method: 'GET', headers: { authorization: 'Bearer local-cron-test' } })
    assert.equal(failed.code, 502)
    assert.doesNotMatch(JSON.stringify(failed.body), /private-service|local-service/)
  } finally {
    globalThis.fetch = originalFetch
    for (const key of ['CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]
    }
  }
})
