import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { buildAttendanceSummary, serializeAttendanceSummaryRows } from '../utils/attendanceSummary.js'

// Exercise page controls and rendering with real attendance calculations while
// replacing network access and React hooks with an isolated in-memory harness.
const compiled = await build({
  stdin: {
    contents: `export { default as Page } from './AttendancePreview.jsx';
      export { hooks } from 'react'; export { fixture } from '../services/firebase';`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  jsx: 'transform', jsxFactory: 'h', jsxFragment: 'fragment',
  banner: { js: 'const fragment = "fragment"; const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });' },
  plugins: [{ name: 'isolated-attendance-preview', setup(api) {
    api.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
    api.onResolve({ filter: /^react$|^xlsx-js-style$|[\\/]contexts[\\/]AuthContext$|[\\/]services[\\/](firebase|attendanceMonthSummary|attendancePenaltiesDb|employeeLeave|supabase)$|[\\/]components[\\/](AttendanceModal|AttendanceImportModal|ResetAttendanceModal|MobileActions)$/ }, args => ({ path: args.path, namespace: 'test' }))
    api.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents:
      args.path === 'react' ? `
        export const hooks = { values: [], index: 0, effects: [] };
        export const useState = initial => {
          const i = hooks.index++;
          if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
          return [hooks.values[i], value => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }];
        };
        export const useMemo = fn => fn();
        export const useCallback = fn => fn;
        export const useEffect = fn => hooks.effects.push(fn);`
      : args.path === 'xlsx-js-style' ? `
        import { fixture } from '../services/firebase';
        export default {
          utils: { json_to_sheet: rows => rows, book_new: () => ({}), book_append_sheet: (book, sheet) => { book.sheet = sheet; } },
          writeFile: (book, filename) => { fixture.download = { book, filename }; }
        };`
      : args.path.endsWith('AuthContext') ? `export const useAuth = () => ({ user: { id: 'admin', role: 'admin' } });`
      : args.path.endsWith('firebase') ? `
        export const fixture = {};
        export const fbGet = async path => path.startsWith('hr/attendanceMonthSummaries/') ? fixture.snapshot
          : path === 'hr/attendanceSettings/default' ? fixture.settings : {};
        export const fbListCollectionIds = async () => ['2026-11'];
        export const fbGetEmployeesDirectory = async () => fixture.employees;
        export const fbGetAttendanceLogsByMonth = async () => fixture.logs;
        export const fbSet = async () => { throw Error('Unexpected write'); };`
      : args.path.endsWith('attendanceMonthSummary') ? `export const rebuildAttendanceMonthSummary = async () => { throw Error('Unexpected rebuild'); };`
      : args.path.endsWith('attendancePenaltiesDb') ? `export const getPenaltiesByMonth = async () => [];`
      : args.path.endsWith('employeeLeave') ? `export const loadEmployeeLeaveSettings = async () => ({});`
      : args.path.endsWith('supabase') ? `export const supabase = {};`
      : /[\\/]AttendanceModal$/.test(args.path) ? `export const formatTimeHM = value => value || ''; export const dayOfWeekFromDate = () => 'T2';`
      : `export default function Stub() { return null; }`
    }))
  } }]
})

const employees = [
  { id: 'e1', employeeId: 'NV001', name: 'Đặng Thị Ánh', department: 'Kế toán', shift: 'Ca Hành chính' },
  { id: 'e2', employeeId: 'NV002', name: 'Trần Bình', department: 'Kinh doanh', shift: 'Ca Hành chính' }
]
const settings = {
  shifts: { administrative: {
    name: 'Ca Hành chính', standardCheckIn: '08:30', standardCheckOut: '17:30',
    splitShift: {
      enabled: true,
      morning: { start: '08:30', end: '12:00', workdays: 0.5 },
      afternoon: { start: '13:30', end: '17:30', workdays: 0.5 }
    }
  } }
}
const makeHarness = async () => {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const { Page, hooks, fixture } = module.exports
  const logs = employees.map(employee => ({
    employeeId: employee.id, date: '2026-11-02', vao: '08:39', ra: '17:40', cong: 0.88, hours: 7.04
  }))
  fixture.settings = settings
  fixture.employees = Object.fromEntries(employees.map(({ id, ...employee }) => [id, employee]))
  fixture.logs = Object.fromEntries(logs.map((log, i) => [`log${i}`, log]))
  fixture.snapshot = { rows: serializeAttendanceSummaryRows(buildAttendanceSummary({
    employees, attendanceLogs: logs, month: '2026-11', attendanceSettings: settings
  })), sourceLogCount: logs.length }
  const render = () => { hooks.index = 0; hooks.effects = []; return Page() }
  render()
  for (const effect of hooks.effects) effect()
  await new Promise(resolve => setImmediate(resolve))
  return { render, fixture }
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]
const textOf = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : tree && typeof tree === 'object' ? tree.children.map(textOf).join(' ') : ''
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && textOf(node).trim() === label)

test('payroll search filters by Vietnamese name, employee code and department, including no matches and clearing', async () => {
  const harness = await makeHarness()
  button(harness.render(), 'Bảng lương').props.onClick()
  for (const [term, ids] of [
    ['dang thi anh', ['e1']], ['NV002', ['e2']], ['ke toan', ['e1']],
    ['khong tim thay', []], ['', ['e1', 'e2']]
  ]) {
    const input = nodes(harness.render()).find(node => node.type === 'input' && node.props.type === 'search')
    input.props.onChange({ target: { value: term } })
    const tree = harness.render()
    const payroll = nodes(tree).find(node => node.type?.name === 'PayrollTable')
    assert.deepEqual(payroll.props.rows.map(row => row.employeeId), ids)
    assert.ok(textOf(tree).replace(/\s+/g, ' ').includes(`${ids.length} nhân viên`))
    const renderedPayroll = payroll.type(payroll.props)
    assert.equal(nodes(renderedPayroll).filter(node => node.type === 'article').length, ids.length)
  }
})

test('row logs and their Excel export use recalculated workdays, actual hours and late minutes', async () => {
  const harness = await makeHarness()
  const open = nodes(harness.render()).find(node => node.type === 'button' && node.props.title === 'Xem bảng chấm công chi tiết đã tải từ Excel')
  await open.props.onClick()
  button(harness.render(), 'Nhật ký theo dòng').props.onClick()
  const tree = harness.render()
  const cells = label => nodes(tree).filter(node => node.type === 'td' && node.props['data-label'] === label).map(textOf)
  assert.deepEqual(cells('Công'), ['1', '1'])
  assert.deepEqual(cells('Giờ'), ['7.35', '7.35'])
  assert.deepEqual(cells('Vào trễ'), ['9p', '9p'])
  await button(tree, 'Tải Excel').props.onClick()
  assert.ok(harness.fixture.download.filename.includes('2026-11'))
  assert.deepEqual(harness.fixture.download.book.sheet.map(row => [row.Công, row.Giờ, row['Vào trễ']]), [
    [1, 7.35, 9], [1, 7.35, 9]
  ])
})
