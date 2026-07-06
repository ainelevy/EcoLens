import { useState, useEffect } from 'react'
import { api } from '../api'

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

function timeAgo(date) {
  if (!date) return 'Never'
  const s = (Date.now() - new Date(date)) / 1000
  if (s < 60)    return 'Just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function StatusBadge({ status }) {
  if (status === 'active')  return <span className="badge badge-green">● Active</span>
  if (status === 'offline') return <span className="badge badge-red">● Offline</span>
  return                           <span className="badge badge-amber">● Maintenance</span>
}

export default function KioskDetailPage({ token, kioskId, navigate }) {
  const [kiosk,   setKiosk]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [resetting, setResetting] = useState(false)
  const [updStat,   setUpdStat]   = useState(false)
  const [copied,    setCopied]    = useState(false)
  const [resetMsg,  setResetMsg]  = useState('')

  useEffect(() => { load() }, [kioskId])

  async function load() {
    try {
      setLoading(true)
      setError(null)
      const d = await api.kiosk(token, kioskId)
      setKiosk(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (!window.confirm('Confirm: the kiosk bin has been physically emptied and is ready to accept new bottles?')) return
    setResetting(true)
    setResetMsg('')
    try {
      await api.resetCapacity(token, kioskId)
      setResetMsg('Capacity reset. The kiosk will resume accepting bottles automatically.')
      await load()
    } catch (e) {
      alert('Reset failed: ' + e.message)
    } finally {
      setResetting(false)
    }
  }

  async function handleStatusChange(newStatus) {
    setUpdStat(true)
    try {
      await api.updateKiosk(token, kioskId, { status: newStatus })
      await load()
    } catch (e) {
      alert('Update failed: ' + e.message)
    } finally {
      setUpdStat(false)
    }
  }

  function copyId() {
    navigator.clipboard.writeText(kioskId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) return <div className="loading-wrap">⏳ Loading kiosk…</div>
  if (error)   return <div className="error-wrap">⚠ {error}</div>
  if (!kiosk)  return null

  const bottles  = kiosk.currentBottleCount || 0
  const capacity = kiosk.capacity || 300
  const pct      = Math.min((bottles / capacity) * 100, 100)
  const barCls   = pct < 70 ? 'prog-green' : pct < 90 ? 'prog-amber' : 'prog-red'

  const stats = [
    { label: 'Total Sessions',  value: kiosk.stats?.totalSessions   ?? 0, color: 'var(--teal)'  },
    { label: 'Total Disposals', value: kiosk.stats?.totalDisposals  ?? 0, color: 'var(--teal)'  },
    { label: 'Accepted',        value: kiosk.stats?.acceptedDisposals ?? 0, color: 'var(--green)' },
    { label: 'Rejected',        value: kiosk.stats?.rejectedDisposals ?? 0, color: 'var(--red)'   },
    { label: 'Points Awarded',  value: (kiosk.stats?.totalPointsAwarded || 0).toLocaleString(), color: 'var(--amber)' },
  ]

  return (
    <div>
      <button className="back-btn" onClick={() => navigate('kiosks')}>← Back to Kiosks</button>

      {/* Header card */}
      <div className="card section-gap">
        <div className="flex justify-between items-start flex-wrap gap-16">
          <div>
            <div className="flex items-center gap-12" style={{ marginBottom: 8 }}>
              <div className="page-title">{kiosk.unitName}</div>
              <StatusBadge status={kiosk.status} />
            </div>
            <div className="c-gray fs-13">📍 {kiosk.location}</div>
            <div className="c-teal fs-13 mt-4 mono fw-600">Code: {kiosk.unitCode}</div>
            <div className="flex items-center gap-8 mt-4">
              <span className="c-gray fs-11 mono">{kiosk.id}</span>
              <button className="btn btn-ghost btn-sm" onClick={copyId}>
                {copied ? '✓ Copied' : 'Copy ID'}
              </button>
            </div>
            <div className="c-gray fs-11 mt-4">Last active: {timeAgo(kiosk.lastSeenAt)}</div>
          </div>
          <div className="flex gap-8 items-center flex-wrap">
            <select
              className="form-select"
              style={{ width: 'auto', padding: '7px 12px' }}
              value={kiosk.status}
              onChange={e => handleStatusChange(e.target.value)}
              disabled={updStat}
            >
              <option value="active">Active</option>
              <option value="offline">Offline</option>
              <option value="maintenance">Maintenance</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid section-gap" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {stats.map(s => (
          <div key={s.label} className="stat-card" style={{ borderLeftColor: s.color }}>
            <div className="stat-value" style={{ fontSize: 24 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Capacity */}
      <div className="card section-gap">
        <div className="card-header">
          <div className="card-title">Bin Capacity</div>
          {bottles >= capacity
            ? <span className="badge badge-red">● FULL — needs emptying</span>
            : <span className="badge badge-green">● Space available</span>}
        </div>

        {resetMsg && <div className="alert alert-success" style={{ marginBottom: 16 }}>{resetMsg}</div>}

        <div style={{ marginBottom: 14 }}>
          <div className="flex justify-between fs-13 c-gray" style={{ marginBottom: 8 }}>
            <span>{bottles} bottle{bottles !== 1 ? 's' : ''} collected</span>
            <span>{capacity - bottles} slot{capacity - bottles !== 1 ? 's' : ''} remaining out of {capacity}</span>
          </div>
          <div className="prog-wrap" style={{ height: 16 }}>
            <div className={`prog-bar ${barCls}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="fs-11 c-gray mt-4">{pct.toFixed(0)}% full</div>
        </div>

        <div className="flex items-center gap-12 flex-wrap">
          <button
            className="btn btn-danger"
            onClick={handleReset}
            disabled={resetting || bottles === 0}
          >
            {resetting ? 'Resetting…' : '🗑 Reset Capacity (Kiosk Emptied)'}
          </button>
          {bottles === 0 && (
            <span className="c-gray fs-12">Bin is empty — nothing to reset.</span>
          )}
        </div>
        <div className="fs-12 c-gray mt-12" style={{ lineHeight: 1.7 }}>
          Click Reset only after physically emptying the kiosk bin. The kiosk software detects the reset
          automatically within 60 seconds and resumes accepting bottles.
        </div>
      </div>

      {/* Recent events */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Recent Disposal Events</div>
          <span className="badge badge-gray">{kiosk.recentEvents?.length || 0} shown</span>
        </div>

        {!kiosk.recentEvents?.length ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <div>No disposal events recorded for this kiosk yet.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th>Classification</th>
                  <th>Confidence</th>
                  <th>Result</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {kiosk.recentEvents.map(ev => (
                  <tr key={ev.id}>
                    <td className="td-muted fs-12">{fmt(ev.createdAt)}</td>
                    <td className="td-mono">{ev.classifiedAs}</td>
                    <td className="td-muted">{(ev.confidence * 100).toFixed(0)}%</td>
                    <td>
                      {ev.isPlastic
                        ? <span className="badge badge-green">✓ Accepted</span>
                        : <span className="badge badge-red">✗ Rejected</span>}
                    </td>
                    <td className="c-amber fw-600">
                      {ev.pointsAwarded > 0 ? `+${ev.pointsAwarded}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
