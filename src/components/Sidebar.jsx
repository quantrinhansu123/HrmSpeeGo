import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Sidebar() {
  const location = useLocation()
  const { user } = useAuth()

  const staffMenuItems = [
    { path: '/dashboard', icon: 'fas fa-home', label: 'Tổng quan' },
    { path: '/employees', icon: 'fas fa-users', label: 'Hồ sơ nhân sự' },
    { path: '/recruitment', icon: 'fas fa-user-plus', label: 'Tuyển dụng' },
    { path: '/salary', icon: 'fas fa-money-bill-wave', label: 'Lương & Phúc lợi' },
    { path: '/competency', icon: 'fas fa-chart-line', label: 'Khung năng lực' },
    { path: '/kpi', icon: 'fas fa-bullseye', label: 'KPI' },
    { path: '/tasks', icon: 'fas fa-tasks', label: 'Công việc' },
    { path: '/approvals', icon: 'fas fa-stamp', label: 'Đề xuất' },
    { path: '/attendance', icon: 'fas fa-clock', label: 'Chấm công' },
    { path: '/cham-cong-online', icon: 'fas fa-camera', label: 'Chấm công online' },
    { path: '/bang-cong-preview', icon: 'fas fa-calendar-check', label: 'Bảng Công' },
    { path: '/bang-phat', icon: 'fas fa-file-invoice-dollar', label: 'Bảng phạt' }
  ]
  const menuItems = user?.role === 'user'
    ? [
        { path: '/bang-cong', icon: 'fas fa-calendar-check', label: 'Bảng công' },
        { path: '/cham-cong-online', icon: 'fas fa-camera', label: 'Chấm công online' }
      ]
    : staffMenuItems

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/speego-logo.png" alt="SpeeGo Logistics" />
        <span>SpeeGo HR</span>
      </div>

      {menuItems.map(item => (
        <Link
          key={item.path}
          to={item.path}
          className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
        >
          <i className={item.icon}></i>
          <span>{item.label}</span>
        </Link>
      ))}
    </aside>
  )
}

export default Sidebar
