export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
export const MAX_ATTACHMENTS = 5
export const MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024

export const validateAttachmentFiles = (files, existing = []) => {
  if (files.length + existing.length > MAX_ATTACHMENTS) throw new Error('Tối đa 5 tệp đính kèm.')
  if (files.some(file => file.size > MAX_ATTACHMENT_BYTES)) throw new Error('Mỗi tệp đính kèm tối đa 2 MB.')
  const total = [...existing, ...files].reduce((sum, file) => sum + (Number(file.size) || 0), 0)
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Tổng dung lượng tệp đính kèm tối đa 5 MB.')
}

export const readAttachmentFiles = async (files, existing = []) => {
  validateAttachmentFiles(files, existing)
  return Promise.all(files.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, size: file.size, type: file.type, data: reader.result })
    reader.onerror = () => reject(new Error(`Không đọc được tệp “${file.name}”.`))
    reader.onabort = () => reject(new Error(`Đã hủy đọc tệp “${file.name}”.`))
    reader.readAsDataURL(file)
  })))
}

// Force embedded files to download rather than execute document content in the app.
export const attachmentHref = attachment => {
  const data = String(attachment?.data || '')
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\r\n]*)$/.exec(data)
  if (match) return `data:application/octet-stream;base64,${match[1]}`
  const url = String(attachment?.url || '')
  return /^https:\/\//i.test(url) ? url : ''
}
