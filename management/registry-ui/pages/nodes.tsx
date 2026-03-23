import React, { useEffect, useMemo, useState } from 'react';
import { adminLogout, deleteNode, getHealth, listNodes, patchNode } from '../lib/api';
import type { main_Node, main_UpdateRequest } from '../src/generated/client';

function safeStr(v: unknown) {
  return v === null || v === undefined ? '' : String(v);
}

type Draft = {
  location: string;
  note: string;
  tailscale_ip: string;
};

export default function Nodes() {
  const [nodes, setNodes] = useState<main_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingMac, setEditingMac] = useState('');
  const [draft, setDraft] = useState<Draft>({ location: '', note: '', tailscale_ip: '' });
  const [saving, setSaving] = useState(false);

  const editingNode = useMemo(() => {
    if (!editingMac) return null;
    return nodes.find((n) => n.mac === editingMac) || null;
  }, [editingMac, nodes]);

  async function loadNodes() {
    setLoading(true);
    setError('');

    const h = await getHealth();
    if (!h) {
      setLoading(false);
      return;
    }

    const list = await listNodes();
    setNodes(list);
    setLoading(false);
  }

  useEffect(() => {
    loadNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>Nodes</h2>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <a href="/subscriptions" style={{ marginRight: 12 }}>
          Subscriptions
        </a>
        <button onClick={() => loadNodes()} disabled={loading} style={{ padding: '6px 10px' }}>
          Refresh
        </button>
        <button
          onClick={async () => {
            try {
              await adminLogout();
            } finally {
              window.location.href = '/login';
            }
          }}
          style={{ padding: '6px 10px' }}
        >
          Logout
        </button>
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{error}</div> : null}

      {!loading && !error ? (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              minWidth: 920,
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ borderBottom: '1px solid #ddd', padding: '8px 6px' }}>Name</th>
                <th style={{ borderBottom: '1px solid #ddd', padding: '8px 6px' }}>Hostname</th>
                <th style={{ borderBottom: '1px solid #ddd', padding: '8px 6px' }}>Tailscale</th>
                <th style={{ borderBottom: '1px solid #ddd', padding: '8px 6px' }}>Note</th>
                <th style={{ borderBottom: '1px solid #ddd', padding: '8px 6px' }}>MAC</th>
                <th style={{ borderBottom: '1px solid #ddd', padding: '8px 6px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => {
                const isEditing = n.mac === editingMac;
                return (
                  <React.Fragment key={n.mac}>
                    <tr>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                        {safeStr(n.location) || '—'}
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                        {safeStr(n.hostname)}
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                        {safeStr(n.tailscale_ip)}
                      </td>
                      <td
                        style={{
                          borderBottom: '1px solid #eee',
                          padding: '8px 6px',
                          maxWidth: 280,
                        }}
                      >
                        {safeStr(n.note) || '—'}
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                        <code>{safeStr(n.mac)}</code>
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                        {!isEditing ? (
                          <button
                            onClick={() => {
                              setEditingMac(n.mac);
                              setDraft({
                                location: safeStr(n.location),
                                note: safeStr(n.note),
                                tailscale_ip: safeStr(n.tailscale_ip),
                              });
                            }}
                            style={{ padding: '6px 10px' }}
                          >
                            Edit
                          </button>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                              disabled={saving}
                              onClick={async () => {
                                setSaving(true);
                                try {
                                  const patch: Partial<main_UpdateRequest> = {
                                    location: draft.location,
                                    note: draft.note,
                                    tailscale_ip: draft.tailscale_ip,
                                  };
                                  await patchNode(editingMac, patch);
                                  setEditingMac('');
                                  await loadNodes();
                                } catch (e: any) {
                                  setError(e?.error || e?.message || 'Update failed');
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              style={{ padding: '6px 10px' }}
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              disabled={saving}
                              onClick={() => {
                                setEditingMac('');
                                setDraft({ location: '', note: '', tailscale_ip: '' });
                                setError('');
                              }}
                              style={{ padding: '6px 10px' }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}

                        <div style={{ marginTop: 6 }}>
                          <button
                            disabled={isEditing || saving}
                            onClick={async () => {
                              const ok = window.confirm(`Delete node ${n.mac}?`);
                              if (!ok) return;
                              try {
                                await deleteNode(n.mac);
                                await loadNodes();
                              } catch (e: any) {
                                setError(e?.error || e?.message || 'Delete failed');
                              }
                            }}
                            style={{ padding: '6px 10px' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isEditing ? (
                      <tr>
                        <td colSpan={6} style={{ borderBottom: '1px solid #eee', padding: 12 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10 }}>
                            <label>
                              Location
                              <input
                                style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
                                value={draft.location}
                                onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                              />
                            </label>
                            <label>
                              Note
                              <input
                                style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
                                value={draft.note}
                                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                              />
                            </label>
                            <label>
                              Tailscale IP
                              <input
                                style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
                                value={draft.tailscale_ip}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, tailscale_ip: e.target.value }))
                                }
                                placeholder="pending"
                              />
                            </label>
                            <div style={{ color: '#666', fontSize: 12 }}>
                              {editingNode ? (
                                <div>
                                  Registered: {safeStr(editingNode.registered_at)}
                                  <br />
                                  LastSeen: {safeStr(editingNode.last_seen)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

