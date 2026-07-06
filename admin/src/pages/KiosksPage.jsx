import { useState, useEffect } from 'react'
import { api } from '../api'

function timeAgo(date) {
  if (!date) return 'Never'
  const s = (Date.now() - new Date(date)) / 1000
  if (s < 60)    return 'Just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function StatusBadge({ status }) {
  if (status === 'active')      return <span className="badge badge-green">● Active</span>
  if (status === 'offline')     return <span className="badge badge-red">● Offline</span>
  return                               <span className="badge badge-amber">● Maintenance</span>
}

function CapBar({ current, max }) {
  const cap = max || 300
  const pct = Math.min(((current || 0) / cap) * 100, 100)
  const cls = pct < 70 ? 'prog-green' : pct < 90 ? 'prog-amber' : 'prog-red'
  return (
    <div style={{ minWidth: 110 }}>
      <div className="flex justify-between fs-11 c-gray mb-4">
        <span>{current || 0}/{cap}</span>
        {pct >= 100 ? <span className="c-red fw-600">FULL</span>
          : pct >= 80 && <span className="c-amber fw-600">NEARLY FULL</span>}
      </div>
      <div className="prog-wrap" style={{ height: 7 }}>
        <div className={`prog-bar ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function KiosksPage({ token, navigate }) {
  const [kiosks,      setKiosks]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [showModal,   setShowModal]   = useState(false)
  const [form,        setForm]        = useState({ unitName: '', location: '' })
  const [saving,      setSaving]      = useState(false)
  const [saveErr,     setSaveErr]     = useState('')
  const [registered,  setRegistered]  = useState(null)   // newly registered kiosk (to show UUID)
  const [resetting,   setResetting]   = useState(null)
  const [copied,      setCopied]      = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const d = await api.kiosks(token)
      setKiosks(d.kiosks || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setSaving(true)
    setSaveErr('')
    try {
      const d = await api.registerKiosk(token, { unitName: form.unitName, location: form.location })
      setRegistered(d.unit)
      setShowModal(false)
      setForm({ unitName: '', location: '' })
      load()
    } catch (e) {
      setSaveErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleReset(id, name) {
    if (!window.confirm(`Reset bin counter for "${name}"?\n\nOnly do this after physically emptying the kiosk.`)) return
    setResetting(id)
    try {
      await api.resetCapacity(token, id)
      load()
    } catch (e) {
      alert('Reset failed: ' + e.message)
    } finally {
      setResetting(null)
    }
  }

  function copyUUID(id) {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) return <div className="loading-wrap">⏳ Loading kiosks…</div>
  if (error)   return <div className="error-wrap">⚠ {error}</div>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Kiosks</div>
          <div className="page-sub">{kiosks.length} kiosk{kiosks.length !== 1 ? 's' : ''} registered</div>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
          <button className="btn btn-primary" onClick={() => { setShowModal(true); setSaveErr('') }}>
            + Register Kiosk
          </button>
        </div>
      </div>

      {/* Newly registered kiosk — show UUID to copy */}
      {registered && (
        <div className="alert alert-success section-gap">
          <div className="fw-600 mb-4">✓ Kiosk "{registered.unitName}" registered!</div>
          <div className="fs-12 c-gray mb-8">
            Copy the UUID below and paste it as <code style={{ color: 'var(--green)' }}>UNIT_ID</code> in <code>kiosk.py</code> on the Raspberry Pi for this kiosk.
          </div>
          <div className="copy-box">
            <span>{registered.id}</span>
            <button className="btn btn-sm btn-secondary" onClick={() => copyUUID(registered.id)}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setRegistered(null)}
            style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer', fontSize: 12 }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="card">
        {kiosks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⬡</div>
            <div style={{ marginBottom: 16 }}>No kiosks registered yet.</div>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              Register your first kiosk
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kiosk Name</th>
                  <th>Unit Code</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Bin Capacity</th>
                  <th>Last Active</th>
                  <th>Disposals</th>
                  <th>Pts Awarded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {kiosks.map(k => (
                  <tr key={k.id}>
                    <td className="fw-600">{k.unitName}</td>
                    <td className="td-muted td-mono">{k.unitCode}</td>
                    <td className="td-muted">{k.location}</td>
                    <td><StatusBadge status={k.status} /></td>
                    <td><CapBar current={k.currentBottleCount} max={k.capacity} /></td>
                    <td className="td-muted fs-12">{timeAgo(k.lastSeenAt)}</td>
                    <td>{k.stats?.totalDisposals ?? '—'}</td>
                    <td className="c-amber">{(k.stats?.totalPointsAwarded || 0).toLocaleString()}</td>
                    <td>
                      <div className="flex gap-8">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => navigate('kiosk-detail', k.id)}
                        >
                          View
                        </button>
                        {(k.currentBottleCount || 0) > 0 && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleReset(k.id, k.unitName)}
                            disabled={resetting === k.id}
                          >
                            {resetting === k.id ? '…' : 'Reset'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Register kiosk modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-title">Register New Kiosk</div>

            {saveErr && <div className="alert alert-error">{saveErr}</div>}

            <form onSubmit={handleRegister}>
              <div className="form-group">
                <label className="form-label">Kiosk Name</label>
                <input
                  className="form-input"
                  value={form.unitName}
                  onChange={e => setForm(f => ({ ...f, unitName: e.target.value }))}
                  placeholder="e.g. Garden City Mall"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Location / Address</label>
                <input
                  className="form-input"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Kampala, Kisementi"
                  required
                />
              </div>

              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                💡 After registering, copy the returned UUID and set it as{' '}
                <code style={{ color: 'var(--green)' }}>UNIT_ID</code> in <code>kiosk.py</code> on that Pi.
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => { setShowModal(false); setSaveErr('') }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Registering…' : 'Register Kiosk'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
