import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { formatDateDisplay, getEmployeeEmploymentStatus } from '../utils/helpers'
import { getEmployeeStatRows } from '../utils/employeeDirectoryStats'
import ResetDataModal from './ResetDataModal'

const EmployeeModal = lazy(() => import('./EmployeeModal'))
const StatusHistoryView = lazy(() => import('./StatusHistoryView'))

const getName = (employee) => employee.ho_va_ten || employee.name || employee.Tên || 'Chưa cập nhật'
const getTinhTrang = (employee) => getEmployeeEmploymentStatus(employee)
const getShift = (employee) => String(employee?.ca_lam_viec || employee?.shift || '').trim()
const isResigned = (employee) =>
    getTinhTrang(employee) === 'Nghỉ việc'

const STAT_CARDS = [
    { key: 'all', label: 'Tổng nhân sự', icon: 'fa-users', tone: 'blue' },
    { key: 'probation', label: 'Nhân sự thử việc', icon: 'fa-user-clock', tone: 'orange' },
    { key: 'official', label: 'Nhân sự chính thức', icon: 'fa-user-check', tone: 'green' },
    { key: 'expiring', label: 'Hợp đồng sắp hết hạn', icon: 'fa-file-circle-exclamation', tone: 'red', title: 'Hợp đồng hết hạn trong 60 ngày tới' },
    { key: 'missingDocuments', label: 'Hồ sơ thiếu giấy tờ', icon: 'fa-folder-open', tone: 'purple', title: 'Hồ sơ chưa có CCCD hoặc ngày sinh' },
    { key: 'frequentLate', label: 'Đi muộn nhiều', icon: 'fa-clock', tone: 'red', activity: true },
    { key: 'frequentLeave', label: 'Nghỉ phép nhiều', icon: 'fa-calendar-minus', tone: 'orange', activity: true },
    { key: 'birthday', label: 'Sinh nhật tháng này', icon: 'fa-cake-candles', tone: 'pink' },
    { key: 'anniversary', label: 'Sắp đến thâm niên', icon: 'fa-award', tone: 'teal', title: 'Kỷ niệm ngày vào làm trong 30 ngày tới' }
]

function EmployeeDirectory({
    companyId, employees, filteredEmployees, activeTab, setActiveTab, searchTerm, setSearchTerm,
    filterBranch, setFilterBranch,
    filterDept, setFilterDept, filterStatus, setFilterStatus, filterContract, setFilterContract,
    filterShift = '', setFilterShift,
    statFilter = '', onSelectStat, onClearStat, activityByEmployee = {}, activityLoading = false, activityError = '', contractError = '',
    selectedEmployee, setSelectedEmployee, isModalOpen, setIsModalOpen, isReadOnly, setIsReadOnly,
    onReload, onExport, onDownloadTemplate, onImport, onDelete, onResolveEmployee,
    onResetData, onResetFilters, adminEmail
}) {
    const importInputRef = useRef(null)
    const [openMenu, setOpenMenu] = useState(null)
    const [openingEmployee, setOpeningEmployee] = useState(false)
    const [isResetModalOpen, setIsResetModalOpen] = useState(false)
    const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
    const [mobileStatsExpanded, setMobileStatsExpanded] = useState(false)
    const [mobileTabsOpen, setMobileTabsOpen] = useState(false)
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

    const activeEmployees = useMemo(
        () => employees.filter(employee => !isResigned(employee)),
        [employees]
    )

    const daysUntil = (value) => {
        if (!value) return null
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? null : Math.ceil((date.getTime() - Date.now()) / 86400000)
    }

    const now = new Date()
    const expiring = getEmployeeStatRows(employees, 'expiring', activityByEmployee, now)
    const branches = [...new Set(activeEmployees.map(employee => employee.chi_nhanh).filter(Boolean))].sort()
    const departments = [...new Set(activeEmployees.map(employee => employee.bo_phan).filter(Boolean))].sort()
    const contracts = [...new Set(activeEmployees.map(employee => employee.loai_hop_dong || employee.contractType).filter(Boolean))].sort()
    const shifts = [...new Set(activeEmployees.map(getShift).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'))
    const noShiftCount = activeEmployees.filter(employee => !getShift(employee)).length
    const stats = STAT_CARDS.map(card => ({
        ...card,
        value: (card.activity && (activityLoading || activityError)) || (card.key === 'expiring' && contractError)
            ? '—'
            : getEmployeeStatRows(employees, card.key, activityByEmployee, now).length,
        title: card.title || (card.key === 'frequentLate'
            ? `Trên 3 lần đi muộn trong năm ${now.getFullYear()}, theo Bảng công đã tổng hợp`
            : card.key === 'frequentLeave'
                ? `Trên 8 công phép trong năm ${now.getFullYear()}, theo Bảng công đã tổng hợp`
                : card.label)
    }))
    const selectedStat = stats.find(card => card.key === statFilter)
    const activeFilterCount = [filterBranch, filterDept, filterContract, filterShift, filterStatus].filter(Boolean).length

    const openEmployee = async (employee, readOnly = true) => {
        if (openingEmployee) return
        setOpenMenu(null)
        setIsReadOnly(readOnly)
        if (!employee) {
            setSelectedEmployee(null)
            setIsModalOpen(true)
            return
        }
        setOpeningEmployee(true)
        try {
            const full = onResolveEmployee ? await onResolveEmployee(employee) : employee
            setSelectedEmployee(full || employee)
            setIsModalOpen(true)
        } finally {
            setOpeningEmployee(false)
        }
    }

    useEffect(() => {
        if (!openMenu) return undefined
        const close = () => setOpenMenu(null)
        document.addEventListener('click', close)
        return () => document.removeEventListener('click', close)
    }, [openMenu])

    useEffect(() => {
        const closeOnOutsideClick = event => {
            if (!event.target.closest('.employees-mobile-actions')) setMobileMoreOpen(false)
            if (!event.target.closest('.employees-tabs-wrap')) setMobileTabsOpen(false)
        }
        const closeOnEscape = event => {
            if (event.key !== 'Escape') return
            setMobileMoreOpen(false)
            setMobileTabsOpen(false)
            setMobileFiltersOpen(false)
        }
        document.addEventListener('pointerdown', closeOnOutsideClick)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick)
            document.removeEventListener('keydown', closeOnEscape)
        }
    }, [])

    return (
        <div className={`employees-page${openingEmployee ? ' is-opening' : ''}`}>
            <header className="employees-hero">
                <div className="employees-hero__intro">
                    <h1><i className="fas fa-users"></i> Quản lý nhân sự</h1>
                    <p>Quản lý tập trung hồ sơ, hợp đồng và tình trạng nhân viên</p>
                    <div className="employees-mobile-actions">
                        <button type="button" className="btn btn-primary" onClick={() => openEmployee(null, false)}><i className="fas fa-plus"></i> Thêm nhân viên</button>
                        <button type="button" className="btn employees-mobile-more-trigger" aria-label="Tác vụ khác" aria-expanded={mobileMoreOpen} onClick={() => setMobileMoreOpen(open => !open)}><i className="fas fa-ellipsis"></i></button>
                        {mobileMoreOpen && <div className="employees-mobile-more-menu">
                            <button type="button" onClick={() => { setMobileMoreOpen(false); onDownloadTemplate?.() }}><i className="fas fa-download"></i> Tải mẫu Excel</button>
                            <button type="button" onClick={() => { setMobileMoreOpen(false); importInputRef.current?.click() }}><i className="fas fa-file-import"></i> Nhập Excel</button>
                            <button type="button" onClick={() => { setMobileMoreOpen(false); onExport?.() }}><i className="fas fa-file-excel"></i> Xuất Excel</button>
                            <button type="button" className="danger" onClick={() => { setMobileMoreOpen(false); setIsResetModalOpen(true) }}><i className="fas fa-trash-can"></i> Reset dữ liệu</button>
                        </div>}
                    </div>
                </div>
                <div className="employees-hero__actions">
                    <button className="btn" onClick={onDownloadTemplate}><i className="fas fa-download"></i> Tải mẫu Excel</button>
                    <button className="btn" onClick={onExport}><i className="fas fa-file-excel"></i> Xuất Excel</button>
                    <button className="btn" onClick={() => importInputRef.current?.click()}><i className="fas fa-file-import"></i> Nhập Excel</button>
                    <input ref={importInputRef} className="employees-file-input" type="file" accept=".xlsx,.xls,.csv" onChange={onImport} />
                    <button className="btn btn-outline-danger" onClick={() => setIsResetModalOpen(true)} title="Xóa dữ liệu nhân sự đã dùng/thử nghiệm">
                        <i className="fas fa-trash-can"></i> Reset dữ liệu
                    </button>
                    <button className="btn btn-primary" onClick={() => openEmployee(null, false)}><i className="fas fa-plus"></i> Thêm nhân viên</button>
                </div>
            </header>

            <section className={`hr-overview${mobileStatsExpanded ? ' is-mobile-expanded' : ''}`}>
                {stats.map(({ key, label, value, icon, tone, title, activity }) => (
                    <button key={key} type="button"
                        className={`hr-stat hr-stat--${tone}${(key === 'all' ? !statFilter && activeTab === 'list' : statFilter === key) ? ' is-selected' : ''}`}
                        onClick={() => onSelectStat?.(key)}
                        disabled={(activity && (activityLoading || Boolean(activityError))) || (key === 'expiring' && Boolean(contractError))}
                        aria-pressed={key === 'all' ? !statFilter && activeTab === 'list' : statFilter === key}
                        title={title}>
                        <span className="hr-stat__icon"><i className={`fas ${icon}`}></i></span>
                        <span><strong>{value}</strong><small>{label}</small></span>
                    </button>
                ))}
            </section>
            <button type="button" className="employees-mobile-stats-toggle" aria-expanded={mobileStatsExpanded} onClick={() => setMobileStatsExpanded(expanded => !expanded)}>
                {mobileStatsExpanded ? 'Thu gọn chỉ số' : 'Xem tất cả chỉ số'} <i className={`fas ${mobileStatsExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            </button>
            {activityError && <p className="employees-stat-error" role="alert">{activityError}</p>}
            {contractError && <p className="employees-stat-error" role="alert">{contractError}</p>}

            <div className="employees-tabs-wrap">
                <button type="button" className="employees-mobile-tabs-trigger" aria-expanded={mobileTabsOpen} onClick={() => setMobileTabsOpen(open => !open)}>
                    <span><i className={`fas ${activeTab === 'history' ? 'fa-clock-rotate-left' : activeTab === 'expiring' ? 'fa-triangle-exclamation' : 'fa-list'}`}></i> {activeTab === 'history' ? 'Lịch sử biến động' : activeTab === 'expiring' ? 'Hợp đồng sắp hết hạn' : 'Danh sách nhân viên'}</span>
                    <i className={`fas ${mobileTabsOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                </button>
                <nav className={`employees-tabs${mobileTabsOpen ? ' is-mobile-open' : ''}`} aria-label="Mục nhân sự">
                    <button className={activeTab === 'list' ? 'active' : ''} onClick={() => { setMobileTabsOpen(false); setActiveTab('list'); onClearStat?.() }}><i className="fas fa-list"></i> Danh sách nhân viên</button>
                    <button className={activeTab === 'expiring' ? 'active danger' : ''} onClick={() => { setMobileTabsOpen(false); onSelectStat?.('expiring') }} disabled={Boolean(contractError)}><i className="fas fa-triangle-exclamation"></i> Hợp đồng sắp hết hạn <span>{contractError ? '—' : expiring.length}</span></button>
                    <button className={activeTab === 'history' ? 'active' : ''} onClick={() => { setMobileTabsOpen(false); setActiveTab('history'); onClearStat?.() }}><i className="fas fa-clock-rotate-left"></i> Lịch sử biến động</button>
                </nav>
            </div>

            {activeTab === 'history' ? (
                <Suspense fallback={<div className="loadingState">Đang tải lịch sử...</div>}>
                    <StatusHistoryView companyId={companyId} employees={employees} onDataChange={onReload} />
                </Suspense>
            ) : <>
                {selectedStat && <div className="employees-stat-filter" role="status">
                    <span>Đang xem: <strong>{selectedStat.label}</strong> ({selectedStat.value} nhân viên)
                        <small>{selectedStat.title}</small>
                    </span>
                    <button type="button" onClick={() => { setActiveTab('list'); onClearStat?.() }}>Xóa lọc thống kê</button>
                </div>}
                <section className="employees-filter-card">
                    <div className="employees-filter-primary">
                        <label className="employees-search"><i className="fas fa-search"></i><input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Tìm theo họ tên, email, số điện thoại..." aria-label="Tìm nhân viên" /><input className="employees-search-mobile-input" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Tìm tên, email, SĐT..." aria-label="Tìm nhân viên" /></label>
                        <button type="button" className="btn employees-mobile-filter-trigger" aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen(open => !open)}><i className="fas fa-filter"></i> Lọc{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</button>
                    </div>
                    {mobileFiltersOpen && <button type="button" className="employees-mobile-filter-backdrop" aria-label="Đóng bộ lọc" onClick={() => setMobileFiltersOpen(false)} />}
                    <div className={`employees-filter-fields${mobileFiltersOpen ? ' is-mobile-open' : ''}`}>
                    <div className="employees-filter-sheet-head"><strong>Bộ lọc</strong><button type="button" aria-label="Đóng bộ lọc" onClick={() => setMobileFiltersOpen(false)}><i className="fas fa-xmark"></i></button></div>
                    <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map(value => <option key={value}>{value}</option>)}
                        <option value="__none__">Chưa có chi nhánh</option>
                    </select>
                    <select value={filterDept} onChange={e => setFilterDept(e.target.value)}><option value="">Tất cả phòng ban</option>{departments.map(value => <option key={value}>{value}</option>)}</select>
                    <select value={filterContract} onChange={e => setFilterContract(e.target.value)}><option value="">Tất cả hợp đồng</option>{contracts.map(value => <option key={value}>{value}</option>)}</select>
                    <select value={filterShift} onChange={e => setFilterShift(e.target.value)}>
                        <option value="">Tất cả ca</option>
                        {shifts.map(value => <option key={value}>{value}</option>)}
                        {noShiftCount > 0 && <option value="__none__">Chưa gán ca</option>}
                    </select>
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                        <option value="">Tất cả trạng thái</option>
                        <option value="Thử việc">Thử việc</option>
                        <option value="Chính thức">Chính thức</option>
                        <option value="Tạm nghỉ">Tạm nghỉ</option>
                        <option value="Nghỉ việc">Đã nghỉ</option>
                    </select>
                    <button className="btn btn-icon" title="Làm mới & đặt lại bộ lọc" aria-label="Làm mới và đặt lại bộ lọc" onClick={onResetFilters || onReload}><i className="fas fa-rotate"></i><span className="employees-mobile-reset-label">Làm mới và xóa lọc</span></button>
                    </div>
                </section>

                <section className="employees-table-card">
                    <div className="employees-table-card__caption">
                        <span>Hiển thị <strong>{filteredEmployees.length}</strong> nhân viên</span>
                    </div>
                    <div className="employees-table-wrap">
                        <table className="employees-table">
                            <thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Chức danh</th><th>Ca</th><th>Ngày vào làm</th><th>Loại hợp đồng</th><th>Tình trạng</th><th></th></tr></thead>
                            <tbody>{filteredEmployees.map((employee, index) => {
                                const name = getName(employee)
                                const status = getTinhTrang(employee)
                                const avatar = employee.avatarDataUrl || employee.avatarUrl || employee.avatar
                                const days = daysUntil(employee.ngay_het_han || employee.contractEndDate || employee.ngay_het_han_hop_dong)
                                return <tr key={employee.id || index} onClick={() => openEmployee(employee)}>
                                    <td><div className="employee-identity"><span className="employee-avatar">{avatar ? <img src={avatar} alt="" loading="lazy" decoding="async" /> : name.charAt(0)}</span><span><strong>{name}</strong><small>{employee.email || employee.sdt || employee.sđt || 'Chưa có thông tin liên hệ'}</small></span></div></td>
                                    <td>{employee.bo_phan || 'Chưa phân bổ'}</td><td>{employee.vi_tri || 'Chưa cập nhật'}</td>
                                    <td>{getShift(employee) || 'Chưa gán ca'}</td>
                                    <td>{formatDateDisplay(employee.ngay_vao_lam) || '—'}</td>
                                    <td><span className="contract-cell">{employee.loai_hop_dong || employee.contractType || 'Chưa cập nhật'}{days !== null && days >= 0 && days <= 60 && <small>Còn {days} ngày</small>}</span></td>
                                    <td><span className={`employee-status ${status === 'Chính thức' ? 'success' : status === 'Thử việc' ? 'warning' : status === 'Nghỉ việc' ? 'danger' : ''}`}><i></i>{status === 'Nghỉ việc' ? 'Đã nghỉ' : status}</span></td>
                                    <td className="employee-row-actions" onClick={(event) => event.stopPropagation()}>
                                        <button
                                            className="employee-row-menu"
                                            title="Thao tác"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                const rowKey = employee.id || `row-${index}`
                                                if (openMenu?.id === rowKey) {
                                                    setOpenMenu(null)
                                                    return
                                                }
                                                const rect = event.currentTarget.getBoundingClientRect()
                                                setOpenMenu({
                                                    id: rowKey,
                                                    top: rect.bottom + 4,
                                                    right: window.innerWidth - rect.right
                                                })
                                            }}
                                        >
                                            <i className="fas fa-ellipsis"></i>
                                        </button>
                                        {openMenu?.id === (employee.id || `row-${index}`) && (
                                            <div
                                                className="employee-row-dropdown"
                                                style={{ top: openMenu.top, right: openMenu.right }}
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <button type="button" onClick={() => openEmployee(employee, true)}>
                                                    <i className="fas fa-eye"></i> Xem
                                                </button>
                                                <button type="button" onClick={() => openEmployee(employee, false)}>
                                                    <i className="fas fa-edit"></i> Sửa
                                                </button>
                                                <button
                                                    type="button"
                                                    className="danger"
                                                    onClick={() => {
                                                        setOpenMenu(null)
                                                        onDelete?.(employee.id, name)
                                                    }}
                                                >
                                                    <i className="fas fa-trash"></i> Xóa
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            })}</tbody>
                        </table>
                        {!filteredEmployees.length && <div className="employee-card-empty">Không tìm thấy nhân viên phù hợp</div>}
                    </div>
                    <div className="employees-mobile-list">
                        {filteredEmployees.map((employee, index) => {
                            const name = getName(employee)
                            const status = getTinhTrang(employee)
                            const avatar = employee.avatarDataUrl || employee.avatarUrl || employee.avatar
                            const rowKey = `mobile:${employee.id || index}`
                            return <div className="employees-mobile-item" key={employee.id || index}>
                                <button type="button" className="employees-mobile-person" onClick={() => openEmployee(employee)} aria-label={`Xem hồ sơ ${name}`}>
                                    <span className="employee-avatar">{avatar ? <img src={avatar} alt="" loading="lazy" decoding="async" /> : name.charAt(0)}</span>
                                    <span className="employees-mobile-person-info">
                                        <strong>{name}</strong>
                                        {employee.employeeId && <small className="employees-mobile-code">{employee.employeeId}</small>}
                                        {(employee.bo_phan || employee.vi_tri) && <small>{[employee.bo_phan, employee.vi_tri].filter(Boolean).join(' · ')}</small>}
                                        <span className={`employee-status ${status === 'Chính thức' ? 'success' : status === 'Thử việc' ? 'warning' : status === 'Nghỉ việc' ? 'danger' : ''}`}><i></i>{status === 'Nghỉ việc' ? 'Đã nghỉ' : status || 'Chưa cập nhật'}</span>
                                    </span>
                                </button>
                                <button type="button" className="employees-mobile-row-menu" aria-label={`Thao tác với ${name}`} aria-expanded={openMenu?.id === rowKey} onClick={event => { event.stopPropagation(); setOpenMenu(openMenu?.id === rowKey ? null : { id: rowKey }) }}><i className="fas fa-ellipsis"></i></button>
                                {openMenu?.id === rowKey && <div className="employees-mobile-row-dropdown" onClick={event => event.stopPropagation()}>
                                    <button type="button" onClick={() => openEmployee(employee, true)}><i className="fas fa-eye"></i> Xem</button>
                                    <button type="button" onClick={() => openEmployee(employee, false)}><i className="fas fa-edit"></i> Sửa</button>
                                    <button type="button" className="danger" onClick={() => { setOpenMenu(null); onDelete?.(employee.id, name) }}><i className="fas fa-trash"></i> Xóa</button>
                                </div>}
                            </div>
                        })}
                        {!filteredEmployees.length && <div className="employee-card-empty">Không tìm thấy nhân viên phù hợp</div>}
                    </div>
                </section>
            </>}

            {isModalOpen && (
                <Suspense fallback={null}>
                    <EmployeeModal companyId={companyId} employee={selectedEmployee} isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setSelectedEmployee(null); setIsReadOnly(false) }} onSave={onReload} readOnly={isReadOnly} departmentOptions={departments} positionOptions={[...new Set(activeEmployees.map(e => e.vi_tri).filter(Boolean))]} />
                </Suspense>
            )}

            <ResetDataModal
                isOpen={isResetModalOpen}
                onClose={() => setIsResetModalOpen(false)}
                onConfirm={onResetData}
                totalEmployees={activeEmployees.length}
                adminEmail={adminEmail}
            />
        </div>
    )
}

export default EmployeeDirectory
