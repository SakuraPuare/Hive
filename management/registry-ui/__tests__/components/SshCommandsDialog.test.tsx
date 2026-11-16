import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { copyMock } = vi.hoisted(() => ({ copyMock: vi.fn() }));

vi.mock('@/lib/openapi-session', () => ({
  apiPath: (path: string) => path,
}));
vi.mock('@/lib/use-clipboard', () => ({
  useClipboard: () => ({ copied: false, copy: copyMock }),
}));

import { SshCommandsDialog } from '@/components/nodes/SshCommandsDialog';

const node = {
  mac: 'aabbccddeeff',
  hostname: 'hive-aabbcc',
  tailscale_ip: '100.64.1.2',
  easytier_ip: '172.20.1.7',
  frp_port: 23456,
};

describe('SshCommandsDialog', () => {
  beforeEach(() => {
    copyMock.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ frp_server_addr: 'vps.example.com' }),
    }));
  });

  it('renders every available path and copies them all', async () => {
    const user = userEvent.setup();
    render(<SshCommandsDialog nodes={[node]} open onOpenChange={() => {}} />);

    expect(await screen.findByText('ssh root@100.64.1.2')).toBeInTheDocument();
    expect(screen.getByText('ssh root@172.20.1.7')).toBeInTheDocument();
    expect(await screen.findByText('ssh -p 23456 root@vps.example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'nodes.sshCopyAll' }));
    expect(copyMock).toHaveBeenCalledWith(
      'ssh root@100.64.1.2\nssh root@172.20.1.7\nssh -p 23456 root@vps.example.com',
    );
  });

  it('omits FRP when the server address is not configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ frp_server_addr: '' }),
    }));
    render(<SshCommandsDialog nodes={[node]} open onOpenChange={() => {}} />);

    expect(await screen.findByText('ssh root@172.20.1.7')).toBeInTheDocument();
    expect(screen.queryByText(/root@vps\.example\.com/)).not.toBeInTheDocument();
  });
});
