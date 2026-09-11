import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import LoadingSpinner from './components/LoadingSpinner'
import ProtectedRoute from './components/ProtectedRoute'

const Approvals = lazy(() => import('./pages/Approvals'))
const Attendance = lazy(() => import('./pages/Attendance'))
const AttendancePreview = lazy(() => import('./pages/AttendancePreview'))
const AttendancePenalties = lazy(() => import('./pages/AttendancePenalties'))
const Competency = lazy(() => import('./pages/Competency'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const EmployeeLogin = lazy(() => import('./pages/EmployeeLogin'))
const Employees = lazy(() => import('./pages/Employees'))
const GradingPage = lazy(() => import('./pages/GradingPage'))
const KPI = lazy(() => import('./pages/KPI'))
const Login = lazy(() => import('./pages/Login'))
const MyAttendance = lazy(() => import('./pages/MyAttendance'))
const OnlineAttendance = lazy(() => import('./pages/OnlineAttendance'))
const Recruitment = lazy(() => import('./pages/Recruitment'))
const Salary = lazy(() => import('./pages/Salary'))
const Tasks = lazy(() => import('./pages/Tasks'))

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
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/recruitment" element={<Recruitment />} />
              <Route path="/salary" element={<Salary />} />
              <Route path="/competency" element={<Competency />} />
              <Route path="/kpi" element={<KPI />} />
              <Route path="/grading/:employeeId?" element={<GradingPage />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/bang-cong-preview" element={<AttendancePreview />} />
              <Route path="/bang-phat" element={<AttendancePenalties />} />
              <Route path="/honor" element={<Navigate to="/bang-cong-preview" replace />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
