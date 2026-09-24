import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'

function Layout({ children }) {
  const location = useLocation()
  // Approvals keeps a mobile-first phone layout on small screens, but on desktop
  // it expands to a full-width workspace while still using the main sidebar.
  const isImmersive = location.pathname.startsWith('/approvals')
  const isEmployee = ['/bang-cong', '/cham-cong-online', '/ngay-nghi-phep'].includes(location.pathname)
  const [menuOpen, setMenuOpen] = useState(false)

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
