export const LATE_EARLY_WORKDAY_THRESHOLD = 60

export const isLateEarlyRequest = (request = {}) =>
  request.templateId === 'late-early' || request.templateBaseId === 'late-early'

export const hasApprovedLateEarlyRequest = (requests, employee, date) =>
  requests.some(request => {
    if (request.status !== 'approved' || !isLateEarlyRequest(request)) return false
    if (request.attendanceDate !== date) return false
    if (request.requesterId) return String(request.requesterId) === String(employee.id)
    return Boolean(request.requesterCode &&
      String(request.requesterCode) === String(employee.employeeId || employee.username || ''))
  })
