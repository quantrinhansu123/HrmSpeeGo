import { attachmentHref } from '../utils/attachments'

export default function AttachmentLinks({ attachments = [] }) {
  if (!Array.isArray(attachments) || !attachments.length) return <span>Không có tệp đính kèm</span>
  return <ul className="attachment-links">
    {attachments.map((file, index) => {
      const href = attachmentHref(file)
      return <li key={index}>{href
        ? <a href={href} download={file.name || 'tep-dinh-kem'} target="_blank" rel="noopener noreferrer">{file.name || 'Tải tệp'}</a>
        : <span>{file.name || 'Tệp đính kèm'} (chưa có nội dung tệp)</span>}</li>
    })}
  </ul>
}
