import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isCoreStaffUser } from '../utils/staffAccess'
import Header from './Header'
import Sidebar from './Sidebar'

function Layout({ children }) {
  const location = useLocation()
  const { user } = useAuth()
  // Approvals keeps a mobile-first phone layout on small screens, but on desktop
  // it expands to a full-width workspace while still using the main sidebar.
  const isImmersive = location.pathname.startsWith('/approvals')
  const isEmployee = ['/bang-cong', '/cham-cong-online', '/ngay-nghi-phep'].includes(location.pathname)
  const [menuOpen, setMenuOpen] = useState(false)
  const isStaff = isCoreStaffUser(user)
  const mobileLinks = [
    { to: '/cham-cong-online', icon: 'fa-camera', label: 'Chấm công' },
    { to: user?.role === 'user' ? '/bang-cong' : '/bang-cong-preview', icon: 'fa-calendar-check', label: 'Bảng công' },
    ...(isStaff ? [{ to: '/bang-phat', icon: 'fa-file-invoice-dollar', label: 'Bảng phạt' }] : []),
    { to: '/approvals', icon: 'fa-stamp', label: 'Đề xuất' }
  ]

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.classList.add('menu-open')
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('menu-open')
    }
  }, [menuOpen])

  return (
    <div className={`app-shell${menuOpen ? ' app-shell--menu-open' : ''}`}>
      <Header menuOpen={menuOpen} onMenuToggle={() => setMenuOpen((open) => !open)} />
      <nav className="mobile-priority-nav" aria-label="Truy cập nhanh">
        {mobileLinks.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `mobile-priority-nav__link${isActive ? ' is-active' : ''}`}
          >
            <i className={`fas ${link.icon}`} aria-hidden="true"></i>
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>
      <div
        className={`sidebar-backdrop${menuOpen ? ' is-visible' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden={!menuOpen}
      />
      <div className={`container${isImmersive ? ' container--immersive container--approvals' : ''}${isEmployee ? ' container--employee' : ''}`}>
        <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        <main className="main">
          {children}
        </main>
      </div>
    </div>
  )
}

export default Layout
