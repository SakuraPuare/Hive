import React, { useState } from 'react';
import { adminLogin } from '../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 480 }}>
      <h2>Hive Registry Admin Login</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError('');
          try {
            await adminLogin(username, password);
            window.location.href = '/nodes';
          } catch (e: any) {
            setError(e?.error || 'Login failed');
          } finally {
            setLoading(false);
          }
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <label>
            Username
            <input
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>
            Password
            <input
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
        </div>

        {error && (
          <div style={{ color: 'crimson', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{error}</div>
        )}

        <button
          disabled={loading}
          style={{ padding: '10px 14px', cursor: loading ? 'not-allowed' : 'pointer' }}
          type="submit"
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

