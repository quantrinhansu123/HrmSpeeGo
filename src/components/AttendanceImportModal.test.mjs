import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { build } from 'esbuild'
import XLSX from 'xlsx-js-style'

// Exercise the actual modal handlers without a browser or a database. Hooks and
// JSX are represented as plain objects; all persistence is replaced by spies.
const compiled = await build({
  stdin: {
    contents: `export { default as Modal } from './AttendanceImportModal.jsx';
      export { hooks } from 'react'; export { writes } from '../services/firebase';`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  jsx: 'transform', jsxFactory: 'h', jsxFragment: 'fragment',
  banner: { js: 'const fragment = "fragment"; const h = (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)});' },
  plugins: [{
    name: 'isolated-modal-test',
    setup(api) {
      api.onResolve({ filter: /^(react)$|[\\/]services[\\/](firebase|employeeDirectory)$|[\\/]contexts[\\/]AuthContext$/ }, args => ({ path: args.path, namespace: 'test' }))
      api.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents:
        args.path === 'react' ? `
          export const hooks = { values: [], index: 0 };
          export const useState = initial => {
            const i = hooks.index++;
            if (!(i in hooks.values)) hooks.values[i] = initial;
            return [hooks.values[i], value => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value }];
          };
          export const useMemo = fn => fn();
          export const useRef = initial => useState({ current: initial })[0];`
          : args.path.endsWith('AuthContext') ? `export const useAuth = () => ({ user: { id: 'test-admin', role: 'admin' } });`
          : args.path.endsWith('employeeDirectory') ? `export const createEmployeeDirectoryProfile = () => { throw Error('Unexpected profile write'); };`
          : `export const writes = [];
             export const fbGet = async () => ({});
             export const fbSet = async (...args) => writes.push(args);
             export const fbUpdate = async (...args) => writes.push(args);`
      }))
    }
  }]
})

const makeHarness = (employees, employeeMappings = {}) => {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const { Modal, hooks, writes } = module.exports
  const props = { employees, employeeMappings, isOpen: true, onClose() {}, onSave() {} }
  return {
    writes,
    render() { hooks.index = 0; return Modal(props) }
  }
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]
const textOf = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : tree && typeof tree === 'object' ? tree.children.map(textOf).join(' ') : ''
const findButton = (tree, label) => nodes(tree).find(node => node.type === 'button' && textOf(node).includes(label))
const makeWorkbook = ({ duplicate = false, unknown = false } = {}) => {
  const header = ['STT', '', 'Họ tên', 'Bộ phận', 'Ca làm', 'Loại HĐ', 'Trạng thái', 'Tổng công', ...Array.from({ length: 32 }, (_, i) => i + 1)]
  const employees = Array.from({ length: 40 }, (_, i) => ({
    id: `profile-${i}`, employeeId: `nv${i}`, ho_va_ten: `Nhân Viên ${i}`, bo_phan: 'Sale'
  }))
  const rows = [['BẢNG CÔNG T8/2026'], ['1/8/2026 - 31/8/2026'], [], [], [], header,
    ...employees.map((employee, i) => [i + 1, '', duplicate && i === 1 ? employees[0].ho_va_ten : employee.ho_va_ten,
      'Sale', 'Ca ngày', 'Chính thức', 'Đang làm', 29.5,
      ...Array.from({ length: 32 }, (_, d) => d === 0 ? (unknown ? 'BAD' : 0.5) : d === 1 ? 'X' : 1)]),
    [], ['', '', 'Tuần 1'], ['', '', 'Danh sách VP']]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Selected')
  return { bytes: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), employees }
}
const upload = async (harness, bytes) => {
  let tree = harness.render()
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'file').props.onChange({
    target: { files: [{ name: 'renamed.xlsx', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }] }
  })
  tree = harness.render()
  await findButton(tree, 'Phân tích').props.onClick()
  return harness.render()
}

globalThis.crypto ||= webcrypto
globalThis.alert = message => { throw new Error(`Unexpected alert: ${message}`) }

test('monthly upload previews all 40 people / 1240 days without database writes', async () => {
  const { bytes, employees } = makeWorkbook()
  const harness = makeHarness(employees, {
    'excel::no-code::nhanvien0': { employeeId: 'profile-1' },
    'monthlymatrixspeegooriginal::no-code::nhanvien0salerow7': { employeeId: 'profile-1' }
  })
  const tree = await upload(harness, bytes)
  assert.equal(harness.writes.length, 0)
  const tables = nodes(tree).filter(node => node.type === 'table')
  const people = nodes(tables[0]).filter(node => node.type === 'select')
  assert.equal(people.length, 40)
  assert.equal(people[0].props.value, 'profile-0', 'saved wrong mapping must not win')
  const days = nodes(tables[1]).filter(node => node.type === 'tbody')[0].children
  assert.equal(days.length, 1240)
  assert.match(textOf(days[0]), /01\/08\/2026.*0.5.*0.5.*Matched/)
  assert.match(textOf(days[1]), /02\/08\/2026.*X.*0.*Matched/)
  assert.equal(Boolean(findButton(tree, 'Xác nhận Import').props.disabled), false)
})

test('missing employee has no similar-name suggestion and cannot be assigned to another person', async () => {
  const { bytes, employees } = makeWorkbook()
  const harness = makeHarness(employees.slice(1))
  let tree = await upload(harness, bytes)
  const select = nodes(tree).find(node => node.type === 'select' && node.props.value === '')
  assert.ok(select)
  assert.equal(select.children.some(option => option.props.value === 'profile-1'), false)
  select.props.onChange({ target: { value: 'profile-1' } })
  tree = harness.render()
  assert.match(textOf(tree), /Chưa có hồ sơ trùng họ tên/)
  assert.equal(Boolean(findButton(tree, 'Xác nhận Import').props.disabled), true)
  assert.equal(harness.writes.length, 0)
})

test('duplicate source rows are retained and block import instead of silently losing days', async () => {
  const { bytes, employees } = makeWorkbook({ duplicate: true })
  const harness = makeHarness(employees)
  const tree = await upload(harness, bytes)
  assert.match(textOf(tree), /nhiều dòng cùng nhân viên/)
  assert.equal(Boolean(findButton(tree, 'Xác nhận Import').props.disabled), true)
  assert.equal(harness.writes.length, 0)
})

test('unsupported daily cells block confirmation before any writes', async () => {
  const { bytes, employees } = makeWorkbook({ unknown: true })
  const harness = makeHarness(employees)
  const tree = await upload(harness, bytes)
  assert.equal(Boolean(findButton(tree, 'Xác nhận Import').props.disabled), true)
  assert.equal(harness.writes.length, 0)
})

test('actual supplied workbook requires sheet selection and previews August only', {
  skip: !process.env.ATTENDANCE_SAMPLE_PATH
}, async () => {
  const bytes = readFileSync(process.env.ATTENDANCE_SAMPLE_PATH)
  const harness = makeHarness([])
  let tree = await upload(harness, bytes)
  assert.equal(findButton(tree, 'Xác nhận Import'), undefined)
  const select = nodes(tree).find(node => node.type === 'select' && node.children.some(option => option.props.value === 'BẢNG CÔNG T82026'))
  assert.ok(select)
  select.props.onChange({ target: { value: 'BẢNG CÔNG T82026' } })
  tree = harness.render()
  await findButton(tree, 'Phân tích sheet').props.onClick()
  tree = harness.render()
  const tables = nodes(tree).filter(node => node.type === 'table')
  assert.equal(nodes(tables[0]).filter(node => node.type === 'select').length, 40)
  assert.equal(nodes(tables[1]).filter(node => node.type === 'tbody')[0].children.length, 1240)
  assert.match(textOf(tables[0]), /Nguyễn Đức Anh/)
  assert.match(textOf(tables[0]), /Tô Châu/)
  assert.equal(harness.writes.length, 0)
})
