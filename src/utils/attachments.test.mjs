import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentHref, readAttachmentFiles, validateAttachmentFiles } from './attachments.js'

test('giới hạn số tệp, dung lượng mỗi tệp và tổng dung lượng', () => {
  const mb = 1024 * 1024
  assert.doesNotThrow(() => validateAttachmentFiles([{ size: 2 * mb }]))
  assert.throws(() => validateAttachmentFiles([{ size: 2 * mb + 1 }]), /2 MB/)
  assert.throws(() => validateAttachmentFiles(Array(6).fill({ size: 1 })), /5 tệp/)
  assert.throws(() => validateAttachmentFiles([{ size: 1 }], Array(5).fill({ size: 1 })), /5 tệp/)
  assert.throws(() => validateAttachmentFiles(Array(3).fill({ size: 2 * mb })), /5 MB/)
})

test('lưu nội dung tệp để tải lại sau khi tải lại trang', async () => {
  const previous = globalThis.FileReader
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:text/plain;base64,aHI='; this.onload() }
  }
  try {
    const result = await readAttachmentFiles([{ name: 'xac-nhan.txt', size: 2, type: 'text/plain' }])
    const persisted = JSON.parse(JSON.stringify(result))[0]
    assert.equal(persisted.name, 'xac-nhan.txt')
    assert.equal(attachmentHref(persisted), 'data:application/octet-stream;base64,aHI=')
  } finally { globalThis.FileReader = previous }
})

test('tệp cũ chỉ có tên và URL nguy hiểm không trở thành liên kết tải', () => {
  assert.equal(attachmentHref({ name: 'old.pdf' }), '')
  assert.equal(attachmentHref({ url: 'javascript:alert(1)' }), '')
  assert.equal(attachmentHref({ data: 'data:text/html,<script>alert(1)</script>' }), '')
  assert.equal(attachmentHref({ data: 'data:text/html;base64,aHI=' }), 'data:application/octet-stream;base64,aHI=')
  assert.equal(attachmentHref({ url: 'https://example.com/evidence.pdf' }), 'https://example.com/evidence.pdf')
})
