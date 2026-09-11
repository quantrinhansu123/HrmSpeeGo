import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from './LoadingSpinner'

function ProtectedRoute({ allowedRoles, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingSpinner />
  if (!user) {
    return <Navigate to={allowedRoles ? '/login' : '/employee-login'} state={{ from: location }} replace />
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'user' ? '/bang-cong' : '/employees'} replace />
  }
  return children || <Outlet />
}

export default ProtectedRoute
