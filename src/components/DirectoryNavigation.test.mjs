import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const compiled = await build({
    stdin: {
        contents: `export { default as Directory } from './EmployeeDirectory.jsx';
            export { default as Sidebar } from './Sidebar.jsx';
            export { session } from '../contexts/AuthContext';`,
        resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx'
    },
    bundle: true, write: false, platform: 'node', format: 'cjs',
    jsxFactory: 'h', jsxFragment: 'fragment',
    banner: { js: 'const fragment = "fragment"; const h = (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)});' },
    plugins: [{ name: 'ui-test', setup(api) {
        api.onResolve({ filter: /^react$|^react-router-dom$|[\\/]AuthContext$|[\\/](EmployeeModal|StatusHistoryView|ResetDataModal)$/ }, args => ({ path: args.path, namespace: 'stub' }))
        api.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents:
            path === 'react' ? `export const useState = value => [value, () => {}];
                export const useEffect = () => {}; export const useMemo = fn => fn();
                export const useRef = value => ({current:value});
                export const lazy = () => () => {}; export const Suspense = 'suspense';`
            : path === 'react-router-dom' ? `export const Link = 'a';
                export const useLocation = () => ({pathname:'/employees'}); export const useNavigate = () => () => {};`
            : path.endsWith('AuthContext') ? `export const session = {user:{role:'admin'}};
                export const useAuth = () => ({user:session.user, logout:() => {}});`
            : 'export default function Stub() {}'
        }))
    } }]
})
const mod = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports)
const { Directory, Sidebar, session } = mod.exports
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]
const textOf = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
    : tree && typeof tree === 'object' ? tree.children.map(textOf).join(' ') : ''

test('filter chips show selected values and clear individual or all filters without reload', () => {
    const calls = []
    const props = {
        employees: [], filteredEmployees: [], activeTab: 'list',
        searchTerm: 'Lan', filterBranch: '__none__', filterDept: 'Nhân sự',
        filterContract: 'Chính thức', filterShift: '__none__', filterStatus: 'Đang làm',
        statFilter: 'birthday', setActiveTab: value => calls.push(['tab', value]),
        onClearStat: () => calls.push(['stat', '']),
        onReload: () => assert.fail('Clearing filters must not reload data')
    }
    for (const name of ['SearchTerm', 'FilterBranch', 'FilterDept', 'FilterContract', 'FilterShift', 'FilterStatus']) {
        props[`set${name}`] = value => calls.push([name, value])
    }
    const tree = Directory(props)
    const section = nodes(tree).find(node => node.props['aria-label'] === 'Bộ lọc đang áp dụng')
    assert.match(textOf(section), /Chưa có chi nhánh/)
    assert.match(textOf(section), /Chưa gán ca/)
    assert.match(textOf(section), /Tìm thấy\s+0\s+nhân viên/)
    const chips = nodes(section).filter(node => node.type === 'button')
    assert.equal(chips.length, 8)
    chips.find(node => node.props['aria-label'] === 'Xóa lọc Phòng ban: Nhân sự').props.onClick()
    assert.deepEqual(calls.splice(0), [['FilterDept', '']])
    chips.find(node => textOf(node) === 'Xóa bộ lọc').props.onClick()
    assert.equal(calls.length, 8)
    assert.ok(calls.every(([key, value]) => value === (key === 'tab' ? 'list' : '')))
    const empty = Directory({ ...props, searchTerm: '', filterBranch: '', filterDept: '', filterContract: '', filterShift: '', filterStatus: '', statFilter: '' })
    assert.ok(!nodes(empty).some(node => node.props['aria-label'] === 'Bộ lọc đang áp dụng'))
})

test('staff menu groups preserve role restrictions and label only unfinished pages', () => {
    for (const role of ['admin', 'hr', 'manager', 'user', 'accountant']) {
        session.user = {role}
        const tree = Sidebar({})
        const links = nodes(tree).filter(node => node.type === 'a')
        const paths = links.map(node => node.props.to)
        assert.equal(new Set(paths).size, paths.length)
        if (['admin', 'hr', 'manager'].includes(role)) {
            for (const label of ['Nhân sự', 'Chấm công', 'Phê duyệt', 'Cài đặt']) {
                assert.ok(nodes(tree).some(node => node.type === 'section' && node.props['aria-label'] === label))
            }
            assert.equal(paths.includes('/bang-phep'), role !== 'manager')
            assert.equal(paths.includes('/cham-cong-online'), role !== 'admin')
            assert.equal(links.find(node => node.props.to === '/employees').props['aria-current'], 'page')
            assert.equal(nodes(tree).filter(node => node.props.className === 'nav-coming-soon').length, 5)
            assert.ok(!textOf(links.find(node => node.props.to === '/recruitment')).includes('Sắp ra mắt'))
        } else {
            assert.ok(!paths.includes('/employees'))
            assert.ok(!paths.includes('/yeu-cau-dieu-chinh-cong'))
            assert.ok(!paths.includes('/salary'))
        }
    }
})
