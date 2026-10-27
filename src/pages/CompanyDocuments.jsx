import { useCallback, useEffect, useMemo, useState } from 'react'
import { fbDelete, fbGet, fbPush, fbUpdate } from '../services/firebase'
import './CompanyDocuments.css'

export const COMPANY_DOCUMENT_CATEGORIES = [
  { id: 'business_license', label: 'Giấy phép đăng ký kinh doanh' },
  { id: 'legal', label: 'Hồ sơ pháp lý của công ty' },
  { id: 'tax', label: 'Hồ sơ thuế' },
  { id: 'social_insurance', label: 'Hồ sơ BHXH' },
  { id: 'other', label: 'Khác' }
]

const emptyForm = () => ({
  name: '',
  category: 'business_license',
  url: '',
  note: '',
  issuedAt: '',
  expiresAt: ''
})

const categoryLabel = (id) =>
  COMPANY_DOCUMENT_CATEGORIES.find(item => item.id === id)?.label || id || 'Khác'

function CompanyDocuments() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fbGet('hr/companyDocuments')
      const list = data
        ? Object.entries(data).map(([id, value]) => ({ ...value, id }))
        : []
      list.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      setDocuments(list)
    } catch (requestError) {
      console.error(requestError)
      setError(requestError.message || 'Không tải được hồ sơ giấy tờ công ty.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('vi')
    return documents.filter(doc => {
      if (filterCategory && doc.category !== filterCategory) return false
      if (!keyword) return true
      const haystack = `${doc.name || ''} ${doc.note || ''} ${categoryLabel(doc.category)} ${doc.url || ''}`.toLocaleLowerCase('vi')
      return haystack.includes(keyword)
    })
  }, [documents, filterCategory, search])

  const groupedCounts = useMemo(() => {
    const counts = Object.fromEntries(COMPANY_DOCUMENT_CATEGORIES.map(item => [item.id, 0]))
    documents.forEach(doc => {
      const key = counts[doc.category] != null ? doc.category : 'other'
      counts[key] += 1
    })
    return counts
  }, [documents])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setModalOpen(true)
  }

  const openEdit = (doc) => {
    setEditing(doc)
    setForm({
      name: doc.name || '',
      category: doc.category || 'other',
      url: doc.url || '',
      note: doc.note || '',
      issuedAt: doc.issuedAt || '',
      expiresAt: doc.expiresAt || ''
    })
    setModalOpen(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (!form.name.trim()) {
      alert('Vui lòng nhập tên giấy tờ / hồ sơ.')
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const payload = {
        name: form.name.trim(),
        category: form.category || 'other',
        url: form.url.trim(),
        note: form.note.trim(),
        issuedAt: form.issuedAt || '',
        expiresAt: form.expiresAt || '',
        updatedAt: now
      }
      if (editing?.id) {
        await fbUpdate(`hr/companyDocuments/${editing.id}`, payload)
      } else {
        await fbPush('hr/companyDocuments', { ...payload, createdAt: now })
      }
      setModalOpen(false)
      setEditing(null)
      setForm(emptyForm())
      await loadDocuments()
    } catch (requestError) {
      alert('Lỗi lưu hồ sơ: ' + (requestError.message || requestError))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (doc) => {
    if (!doc?.id) return
    if (!confirm(`Xóa hồ sơ “${doc.name}”?`)) return
    try {
      await fbDelete(`hr/companyDocuments/${doc.id}`)
      await loadDocuments()
    } catch (requestError) {
      alert('Không xóa được: ' + (requestError.message || requestError))
    }
  }

  return (
    <div className="company-docs-page">
      <header className="company-docs-header">
        <div>
          <h1>Giấy tờ công ty</h1>
          <p>Lưu trữ và phân loại hồ sơ pháp lý để HR/Admin tra cứu tập trung.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          <i className="fas fa-plus"></i> Thêm hồ sơ
        </button>
      </header>

      <section className="company-docs-stats" aria-label="Thống kê theo nhóm">
        {COMPANY_DOCUMENT_CATEGORIES.map(item => (
          <button
            key={item.id}
            type="button"
            className={`company-docs-stat ${filterCategory === item.id ? 'is-active' : ''}`}
            onClick={() => setFilterCategory(current => current === item.id ? '' : item.id)}
          >
            <span>{item.label}</span>
            <strong>{groupedCounts[item.id] || 0}</strong>
          </button>
        ))}
      </section>

      <div className="company-docs-toolbar">
        <input
          type="search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Tìm theo tên, ghi chú, link..."
        />
        <select value={filterCategory} onChange={event => setFilterCategory(event.target.value)}>
          <option value="">Tất cả nhóm</option>
          {COMPANY_DOCUMENT_CATEGORIES.map(item => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="company-docs-state">Đang tải hồ sơ...</div>
      ) : error ? (
        <div className="company-docs-state is-error">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="company-docs-state">
          Chưa có hồ sơ{filterCategory || search ? ' khớp bộ lọc' : ''}. Bấm <strong>Thêm hồ sơ</strong> để bắt đầu.
        </div>
      ) : (
        <div className="company-docs-table-wrap">
          <table className="company-docs-table">
            <thead>
              <tr>
                <th>STT</th>
                <th>Tên hồ sơ</th>
                <th>Nhóm</th>
                <th>Ngày cấp</th>
                <th>Hết hạn</th>
                <th>Link / tệp</th>
                <th>Ghi chú</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc, index) => (
                <tr key={doc.id}>
                  <td>{index + 1}</td>
                  <td><strong>{doc.name}</strong></td>
                  <td>{categoryLabel(doc.category)}</td>
                  <td>{doc.issuedAt || '—'}</td>
                  <td>{doc.expiresAt || '—'}</td>
                  <td>
                    {doc.url ? (
                      <a href={doc.url} target="_blank" rel="noreferrer">Mở link</a>
                    ) : '—'}
                  </td>
                  <td>{doc.note || '—'}</td>
                  <td className="company-docs-actions">
                    <button type="button" className="btn" onClick={() => openEdit(doc)}>Sửa</button>
                    <button type="button" className="btn is-danger" onClick={() => handleDelete(doc)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="modal show" onClick={() => !saving && setModalOpen(false)}>
          <div className="modal-content" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Sửa hồ sơ giấy tờ' : 'Thêm hồ sơ giấy tờ'}</h3>
              <button type="button" className="modal-close" onClick={() => setModalOpen(false)}>&times;</button>
            </div>
            <form className="modal-body" onSubmit={handleSave}>
              <div className="form-group">
                <label>Tên hồ sơ *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                  placeholder="VD: Giấy phép ĐKKD SpeeGo"
                  required
                />
              </div>
              <div className="form-group">
                <label>Nhóm phân loại</label>
                <select
                  value={form.category}
                  onChange={event => setForm(current => ({ ...current, category: event.target.value }))}
                >
                  {COMPANY_DOCUMENT_CATEGORIES.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Ngày cấp</label>
                  <input
                    type="date"
                    value={form.issuedAt}
                    onChange={event => setForm(current => ({ ...current, issuedAt: event.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Ngày hết hạn</label>
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={event => setForm(current => ({ ...current, expiresAt: event.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Link tài liệu (Drive / file)</label>
                <input
                  type="url"
                  value={form.url}
                  onChange={event => setForm(current => ({ ...current, url: event.target.value }))}
                  placeholder="https://..."
                />
              </div>
              <div className="form-group">
                <label>Ghi chú</label>
                <textarea
                  rows={3}
                  value={form.note}
                  onChange={event => setForm(current => ({ ...current, note: event.target.value }))}
                  placeholder="Ghi chú nội bộ..."
                />
              </div>
              <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={saving}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu hồ sơ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default CompanyDocuments
