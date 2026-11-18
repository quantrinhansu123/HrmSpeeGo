import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

// Exercise the real page handlers with isolated hooks and in-memory services.
const compiled = await build({
  stdin: { contents: `export { default as Approvals } from './Approvals.jsx';
    export { default as LeaveDays } from './LeaveDays.jsx';
    export { hooks } from 'react'; export { router } from 'react-router-dom';
    export { session } from '../contexts/AuthContext';
    export { store } from '../services/firebase';`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  jsxFactory: 'h', jsxFragment: 'fragment',
  banner: { js: 'const fragment = "fragment"; const h = (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)});' },
  plugins: [{ name: 'approval-leave-test', setup(api) {
    api.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
    api.onResolve({ filter: /^react$|^react-router-dom$|[\\/]contexts[\\/]AuthContext$|[\\/]services[\\/](firebase|supabase|employeeLeave|leaveDays)$/ }, args => ({ path: args.path, namespace: 'test' }))
    api.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents:
      path === 'react' ? `
        export const hooks = { values: [], index: 0, effects: [] };
        export const useState = initial => {
          const i = hooks.index++;
          if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
          return [hooks.values[i], value => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value }];
        };
        export const useMemo = fn => fn(); export const useCallback = fn => fn;
        export const useRef = initial => useState({current: initial})[0];
        export const useEffect = fn => hooks.effects.push(fn);`
      : path === 'react-router-dom' ? `
        export const Link = 'a'; export const router = { query: '' };
        export const useSearchParams = () => [new URLSearchParams(router.query), patch => {
          router.query = String(typeof patch === 'function' ? patch(new URLSearchParams(router.query)) : new URLSearchParams(patch));
        }];`
      : path.endsWith('AuthContext') ? `
        export const session = { user: { id: 'employee', role: 'user', ho_va_ten: 'Lan' } };
        export const useAuth = () => ({user:session.user});`
      : path.endsWith('firebase') ? `
        export const store = { requests: {}, days: [], calls: [] };
        export const fbGet = async path => path.endsWith('approvalRequests') ? store.requests : {};
        export const fbPush = async () => {}; export const fbUpdate = async () => {}; export const fbDelete = async () => {};`
      : path.endsWith('supabase') ? `
        export const supabase = {
          from: () => ({select: async () => ({data:[], error:null})}),
          rpc: async () => ({data:{configured:false}, error:null})
        };`
      : path.endsWith('employeeLeave') ? `
        export const previewLeaveRequest = async () => ({});
        export const loadLeaveEmployees = async () => [];`
      : `
        import { store } from '../services/firebase';
        export const loadLeaveDays = async args => { store.calls.push(args); return store.days.filter(day =>
          (!args.employeeId || day.employee_id === args.employeeId) &&
          (!args.approvalRequestId || day.approval_request_id === 'approvalRequests::' + args.approvalRequestId)); };
        export const approveLeaveDay = async ({leaveDayId}) => ({...store.days.find(day => day.id === leaveDayId), status:'approved'});
        export const deleteLeaveDays = async ({ids}) => ids;
        export const loadLeaveDayDetails = async () => ({}); export const adjustLeaveDay = async () => ({});`
    }))
  } }]
})
const mod = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports)
const { Approvals, LeaveDays, hooks, router, session, store } = mod.exports
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]
const textOf = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : tree && typeof tree === 'object' ? tree.children.map(textOf).join(' ').replace(/\s+/g, ' ').trim() : ''
const render = (Page, props) => { hooks.index = 0; hooks.effects = []; return Page(props) }
const mount = async (Page, props) => {
  hooks.values = []
  render(Page, props)
  hooks.effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  return render(Page, props)
}
const request = (id, extra = {}) => ({ id, code: id, requesterId: 'employee', requesterName: 'Lan',
  templateId: 'leave', templateType: 'Đơn xin nghỉ phép', subject: id, content: '',
  status: 'pending', approvalSteps: [], createdAt: '2026-11-18T00:00:00Z', ...extra })
globalThis.localStorage = { getItem: () => null, setItem: () => {} }

test('lọc Nghỉ phép cập nhật danh sách và số lượng, giữ lọc khi chuyển tab và mở đúng mẫu có sẵn', async () => {
  session.user = { id: 'employee', role: 'user', ho_va_ten: 'Lan' }
  store.requests = {
    paid: request('paid'),
    unpaid: request('unpaid', { leaveType: 'unpaid', status: 'approved' }),
    other: request('other', { templateId: 'proposal', templateType: 'Đề xuất khác' })
  }
  router.query = 'tab=sent'
  let tree = await mount(Approvals)
  assert.equal(nodes(tree).filter(node => node.type === 'article').length, 2)
  nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'leave' } })
  tree = render(Approvals)
  assert.equal(nodes(tree).filter(node => node.type === 'article').length, 1)
  assert.match(textOf(nodes(tree).find(node => node.props.className === 'apv-chips')), /Cần làm \( 1 \)/)
  assert.match(textOf(nodes(tree).find(node => node.props.className === 'apv-chips')), /Hoàn thành \( 1 \)/)
  nodes(tree).find(node => node.type === 'article').props.onClick()
  assert.equal(new URLSearchParams(router.query).get('type'), 'leave')
  tree = render(Approvals)
  nodes(tree).find(node => node.props.className === 'apv-topbar__back').props.onClick()
  assert.equal(new URLSearchParams(router.query).get('type'), 'leave')
  tree = render(Approvals)
  nodes(tree).find(node => node.type === 'button' && textOf(node) === 'Quản trị').props.onClick()
  assert.equal(new URLSearchParams(router.query).get('type'), 'leave')
  tree = render(Approvals)
  nodes(tree).find(node => node.type === 'button' && textOf(node).includes('Tạo đơn xin nghỉ phép')).props.onClick()
  assert.equal(new URLSearchParams(router.query).get('template'), 'leave')
  assert.equal(new URLSearchParams(router.query).get('view'), 'create')
})

test('chi tiết đơn nghỉ chứa danh sách ngày liên kết; đơn khác không có khối ngày nghỉ', async () => {
  router.query = 'tab=sent&type=leave&view=detail&id=paid'
  let tree = await mount(Approvals)
  const block = nodes(tree).find(node => node.type === LeaveDays)
  assert.equal(block.props.request.id, 'paid')
  router.query = 'view=detail&id=other'
  tree = render(Approvals)
  assert.ok(!nodes(tree).some(node => node.type === LeaveDays))
})

test('lịch sử trong bộ lọc dùng toàn bộ đơn để tránh lặp bản ghi và giữ ngày của đơn đã xóa', async () => {
  router.query = 'tab=sent&type=leave&filter=done'
  let tree = await mount(Approvals)
  let history = nodes(tree).find(node => node.type === 'details')
  assert.ok(!nodes(history).some(node => node.type === LeaveDays))
  history.props.onToggle({ currentTarget: { open: true } })
  tree = render(Approvals)
  history = nodes(tree).find(node => node.type === 'details')
  const props = nodes(history).find(node => node.type === LeaveDays).props
  assert.equal(props.requests.length, 3)
  store.days = [
    { id: 'linked', employee_id: 'employee', employee_name: 'Lan', leave_date: '2026-11-18', approval_request_id: 'approvalRequests::unpaid' },
    { id: 'manual', employee_id: 'employee', employee_name: 'Lan', leave_date: '2026-11-17', reason: 'Thêm tay' },
    { id: 'deleted', employee_id: 'employee', employee_name: 'Lan', leave_date: '2026-11-16', approval_request_id: 'approvalRequests::deleted', approval_snapshot: { code: 'OLD' }, adjustment_count: 2 },
    { id: 'other-employee', employee_id: 'someone-else', leave_date: '2026-11-15' }
  ]
  tree = await mount(LeaveDays, props)
  assert.equal(nodes(tree).filter(node => node.type === 'tbody').flatMap(node => node.children).length, 2)
  assert.match(textOf(tree), /#OLD/)
  assert.match(textOf(tree), /2 lần/)
  assert.ok(!nodes(tree).some(node => node.type === 'form'))
  assert.ok(!nodes(tree).some(node => node.type === 'button' && textOf(node).includes('Duyệt')))
})

test('quyền ngày nghỉ giữ nguyên: nhân viên chỉ xem của mình, HR/admin được điều chỉnh', async () => {
  const props = { request: request('unpaid', { status: 'approved' }) }
  for (const role of ['user', 'manager', 'accountant', 'hr', 'admin']) {
    session.user = { id: 'employee', role }
    store.calls = []
    const tree = await mount(LeaveDays, props)
    assert.deepEqual(store.calls, [{ companyId: 'speego-original', employeeId: ['hr', 'admin'].includes(role) ? null : 'employee', approvalRequestId: 'unpaid' }])
    assert.equal(textOf(tree).includes('Chi tiết / Điều chỉnh'), ['hr', 'admin'].includes(role))
  }
})
