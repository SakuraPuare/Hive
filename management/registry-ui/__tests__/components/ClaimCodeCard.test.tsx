import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const lookup = vi.fn();
const user = { can: vi.fn(() => true) };
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => ({ user, loading: false }) }));
vi.mock('@/src/generated/client', () => ({ AdminService: {
  adminGetDeviceClaimCode: (...args: unknown[]) => lookup(...args),
} }));
vi.mock('@/lib/openapi-session', () => ({ sessionApi: (p: Promise<unknown>) => p }));
import { ClaimCodeCard } from '@/components/nodes/ClaimCodeCard';

const node = { mac: 'aabbccddeeff', hostname: 'hive-cdeeff' };

describe('Device claim code card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.can.mockReturnValue(true);
  });

  it('shows the stored code and copies it for an operator with node:write', async () => {
    lookup.mockResolvedValue({ mac: node.mac, claim_code: 'K7QF-2M9X', claimable: true });
    render(<ClaimCodeCard node={node} />);
    expect(await screen.findByText('K7QF-2M9X')).toBeInTheDocument();
    expect(screen.getByText('claimCode.hint')).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledWith({ mac: node.mac });
  });

  it('warns that a claimed device code is inactive', async () => {
    lookup.mockResolvedValue({ mac: node.mac, claim_code: 'K7QF-2M9X', claimable: false });
    render(<ClaimCodeCard node={node} />);
    expect(await screen.findByText('claimCode.claimed')).toBeInTheDocument();
  });

  it('explains that pre-migration devices have no stored plaintext', async () => {
    lookup.mockResolvedValue({ mac: node.mac, claim_code: '', claimable: true });
    render(<ClaimCodeCard node={node} />);
    expect(await screen.findByText('claimCode.notStored')).toBeInTheDocument();
  });

  it('hides the card and skips the request for a node:read operator', () => {
    user.can.mockReturnValue(false);
    render(<ClaimCodeCard node={node} />);
    expect(screen.queryByText('claimCode.title')).not.toBeInTheDocument();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('surfaces lookup failures', async () => {
    lookup.mockRejectedValue(new Error('denied'));
    render(<ClaimCodeCard node={node} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
