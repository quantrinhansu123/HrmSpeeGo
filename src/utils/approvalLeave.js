import { normalizeString } from './helpers'

export const isLeaveRequest = (request = {}) => Boolean(
  request.templateId === 'leave' || request.templateBaseId === 'leave' ||
  request.attendanceSync === 'paid-leave' || request.attendanceSync === 'unpaid-leave' ||
  request.leaveStartDate || request.leaveDate ||
  normalizeString(request.templateType || '').includes('nghi phep')
)

export const leaveRequestId = value => String(value || '').replace(/^approvalRequests::/, '')

// Records whose source request was deleted remain accessible alongside manual entries.
export const leaveDaysOutsideRequests = (records, requests) => {
  const ids = new Set(requests.map(request => leaveRequestId(request.id)))
  return records.filter(record => !ids.has(leaveRequestId(record.approval_request_id)))
}
