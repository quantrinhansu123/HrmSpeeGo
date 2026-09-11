import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import LoadingSpinner from './components/LoadingSpinner'
import ProtectedRoute from './components/ProtectedRoute'

const AttendancePreview = lazy(() => import('./pages/AttendancePreview'))
const AttendancePenalties = lazy(() => import('./pages/AttendancePenalties'))
const EmployeeLogin = lazy(() => import('./pages/EmployeeLogin'))
const Employees = lazy(() => import('./pages/Employees'))
const FeatureComingSoon = lazy(() => import('./pages/FeatureComingSoon'))
const Login = lazy(() => import('./pages/Login'))
const MyAttendance = lazy(() => import('./pages/MyAttendance'))
const OnlineAttendance = lazy(() => import('./pages/OnlineAttendance'))

const AppLayout = () => <Layout><Outlet /></Layout>
const STAFF_ROLES = ['admin', 'hr', 'manager']
const ATTENDANCE_ROLES = ['user', ...STAFF_ROLES]

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/employee-login" element={<EmployeeLogin />} />
          <Route element={<ProtectedRoute allowedRoles={ATTENDANCE_ROLES} />}>
            <Route element={<AppLayout />}>
              <Route path="/cham-cong-online" element={<OnlineAttendance />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['user']} />}>
            <Route element={<AppLayout />}>
              <Route path="/bang-cong" element={<MyAttendance />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute allowedRoles={STAFF_ROLES} />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/employees" replace />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/bang-cong-preview" element={<AttendancePreview />} />
              <Route path="/bang-phat" element={<AttendancePenalties />} />
              <Route path="/attendance" element={<Navigate to="/bang-cong-preview" replace />} />
              <Route path="/honor" element={<Navigate to="/bang-cong-preview" replace />} />

              {/* Các tab còn lại: không tải DB, chỉ hiện thông báo demo */}
              <Route path="/dashboard" element={<FeatureComingSoon />} />
              <Route path="/recruitment" element={<FeatureComingSoon />} />
              <Route path="/salary" element={<FeatureComingSoon />} />
              <Route path="/competency" element={<FeatureComingSoon />} />
              <Route path="/kpi" element={<FeatureComingSoon />} />
              <Route path="/grading/:employeeId?" element={<FeatureComingSoon />} />
              <Route path="/tasks" element={<FeatureComingSoon />} />
              <Route path="/approvals" element={<FeatureComingSoon />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
