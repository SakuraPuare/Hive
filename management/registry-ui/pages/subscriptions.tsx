import React, { useState } from 'react';
import { getSubscriptionClashText } from '../lib/api';

export default function Subscriptions() {
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function previewClash() {
    setLoading(true);
    setError('');
    try {
      const txt = await getSubscriptionClashText();
      setPreview(txt);
    } catch (e: any) {
      setError(e?.error || 'Failed to preview Clash YAML');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>Subscriptions</h2>
      <div style={{ marginBottom: 12 }}>
        <a href="/nodes" style={{ marginRight: 12 }}>
          Back to Nodes
        </a>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <a href="/api/subscription" style={{ marginRight: 12 }}>
            Download VLESS
          </a>
          <span style={{ color: '#666' }}>(base64 text)</span>
        </div>
        <div>
          <a href="/api/subscription/clash" style={{ marginRight: 12 }}>
            Download Clash YAML
          </a>
          <span style={{ color: '#666' }}>(Mihomo/Clash Meta)</span>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button disabled={loading} onClick={previewClash} type="button">
          {loading ? 'Loading...' : 'Preview Clash YAML'}
        </button>
      </div>

      {error && <div style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{error}</div>}
      {preview && (
        <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {preview}
        </pre>
      )}
    </div>
  );
}

