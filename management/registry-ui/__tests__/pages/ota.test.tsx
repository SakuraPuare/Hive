import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const user = { id: 1, username: 'admin', can: () => true };
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => ({ user, loading: false }) }));
vi.mock('@/lib/openapi-session', () => ({ apiPath: (path: string) => `/api${path}` }));

import OtaPage from '@/pages/ota';

const fetchMock = vi.fn();
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });

describe('OTA upload and rollout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(response([]));
  });

  it('uploads a bundle and creates a rollout using returned version and checksum', async () => {
    const events = userEvent.setup({ applyAccept: false });
    render(<OtaPage />);
    await events.click(screen.getByRole('button', { name: 'ota.createRollout' }));
    const artifact = { version: '2.1', sha256: 'a'.repeat(64), url: `registry://${'a'.repeat(64)}` };
    fetchMock.mockResolvedValueOnce(response({ id: 'session', chunk_size: 16 * 1024 ** 2 }))
      .mockResolvedValueOnce(response({ status: 'ok' })).mockResolvedValueOnce(response(artifact));
    const file = new File(['bundle'], 'hive-ota-v2.1.tar.gz', { type: 'application/gzip' });
    await events.upload(screen.getByLabelText('ota.uploadBundle'), file);
    await waitFor(() => expect(screen.getByLabelText('ota.fieldVersion')).toHaveValue('2.1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/ota/uploads/session/0', expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' } }));
    expect(screen.queryByLabelText('ota.fieldUrl')).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response({ id: 1, assigned: 0 }));
    await events.click(screen.getByRole('button', { name: 'ota.create' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([path, opts]) => path === '/api/admin/ota/rollouts' && opts.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body)).toEqual({ ...artifact, note: '' });
    });
  });

  it('does not enable publishing after a failed upload', async () => {
    const events = userEvent.setup({ applyAccept: false });
    render(<OtaPage />);
    await events.click(screen.getByRole('button', { name: 'ota.createRollout' }));
    fetchMock.mockResolvedValueOnce(response({ error: 'invalid bundle' }, false));
    await events.upload(screen.getByLabelText('ota.uploadBundle'), new File(['bad'], 'bad.tar.gz'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ota.create' })).toBeDisabled());
    expect(screen.getByLabelText('ota.fieldVersion')).toHaveValue('');
  });

  it('shows installation and rollback counts separately', async () => {
    fetchMock.mockResolvedValue(response([{ id: 1, version: '2.0', total: 3, pending: 0, installing: 1, done: 1, failed: 0, rolled_back: 1, created_at: '2026-10-26T00:00:00Z' }]));
    render(<OtaPage />);
    expect(await screen.findByText('1 ota.statusInstalling')).toBeInTheDocument();
    expect(screen.getByText('1 ota.statusRolledBack')).toBeInTheDocument();
  });
});
