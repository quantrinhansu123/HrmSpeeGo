import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Sidebar() {
  const location = useLocation()
  const { user } = useAuth()

  const primaryStaffItems = [
    { path: '/employees', icon: 'fas fa-users', label: 'Hồ sơ nhân sự' },
    { path: '/cham-cong-online', icon: 'fas fa-camera', label: 'Chấm công online' },
    { path: '/bang-phat', icon: 'fas fa-file-invoice-dollar', label: 'Bảng phạt' },
    { path: '/bang-cong-preview', icon: 'fas fa-calendar-check', label: 'Bảng Công' }
  ]

  const secondaryStaffItems = [
    { path: '/dashboard', icon: 'fas fa-home', label: 'Tổng quan' },
    { path: '/recruitment', icon: 'fas fa-user-plus', label: 'Tuyển dụng' },
    { path: '/salary', icon: 'fas fa-money-bill-wave', label: 'Lương & Phúc lợi' },
    { path: '/competency', icon: 'fas fa-chart-line', label: 'Khung năng lực' },
    { path: '/kpi', icon: 'fas fa-bullseye', label: 'KPI' },
    { path: '/tasks', icon: 'fas fa-tasks', label: 'Công việc' },
    { path: '/approvals', icon: 'fas fa-stamp', label: 'Đề xuất' }
  ]

  const employeeItems = [
    { path: '/bang-cong', icon: 'fas fa-calendar-check', label: 'Bảng công' },
    { path: '/cham-cong-online', icon: 'fas fa-camera', label: 'Chấm công online' }
  ]

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`)

  const renderItems = (items) =>
    items.map(item => (
      <Link
        key={item.path}
        to={item.path}
        className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
      >
        <i className={item.icon}></i>
        <span>{item.label}</span>
      </Link>
    ))

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/speego-logo.png" alt="SpeeGo Logistics" />
        <span>SpeeGo HR</span>
      </div>

      {user?.role === 'user' ? (
        renderItems(employeeItems)
      ) : (
        <>
          <div className="nav-group nav-group--primary">
            {renderItems(primaryStaffItems)}
          </div>
          <div className="nav-group-divider" aria-hidden="true" />
          <div className="nav-group nav-group--secondary">
            {renderItems(secondaryStaffItems)}
          </div>
        </>
      )}
    </aside>
  )
}

export default Sidebar
