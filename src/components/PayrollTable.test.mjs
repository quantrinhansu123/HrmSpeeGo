import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({
  stdin: { contents: `export { default as PayrollTable } from './PayrollTable.jsx'; export { getTemplatePolicy } from '../utils/approvalPolicy.js';`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'fragment',
  banner: { js: `const fragment = 'fragment'; const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });` }
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { PayrollTable, getTemplatePolicy } = module.exports
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]
const textOf = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : tree && typeof tree === 'object' ? tree.children.map(textOf).join(' ') : ''

test('payroll uses consumed and available annual leave, never treats monthly grants as used', () => {
  const tree = PayrollTable({ rows: [{ employeeId: 'employee', employeeName: 'Employee', paidLeaveWorkdays: 4 }],
    employeesById: new Map(), penalties: [], kpiByEmployee: new Map(), month: '2026-11',
    leaveSettings: { employee: { 2026: { total_leave: 12, used: 2, reserved: 1, remaining: 9, months: { 1: 5, 2: 7 } } } } })
  const cells = nodes(tree).find(node => node.type === 'tbody').children[0].children
  assert.equal(textOf(cells[12]), '9.00')
  assert.equal(textOf(cells[13]), '2.00')
  const mobile = nodes(tree).find(node => node.type === 'article')
  assert.match(textOf(mobile), /Phép còn lại 9.00/)
  assert.match(textOf(mobile), /Phép đã dùng 2.00/)
})

test('legacy leave template quota cannot re-enable the removed annual-leave request cap', () => {
  const policy = getTemplatePolicy({ id: 'custom-leave', baseId: 'leave', quotaEnabled: true, maxRequests: 2, quotaPeriod: 'month' })
  assert.equal(policy.quotaEnabled, false)
  assert.equal(policy.maxRequests, 0)
  assert.equal(getTemplatePolicy({ id: 'late-early' }).quotaEnabled, true)
})
