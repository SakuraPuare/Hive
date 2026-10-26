import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const issue = vi.fn();
const revoke = vi.fn();
const user = { can: () => true };
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => ({ user, loading: false }) }));
vi.mock('@/src/generated/client', () => ({ AdminService: {
  serverCredentialIssue: (...args: unknown[]) => issue(...args),
  serverCredentialRevoke: (...args: unknown[]) => revoke(...args),
} }));
vi.mock('@/lib/openapi-session', () => ({ sessionApi: (p: Promise<unknown>) => p }));
import { ServerCredentialCard } from '@/components/nodes/ServerCredentialCard';

function Card({ owned = false }: { owned?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  return <ServerCredentialCard node={{ mac: 'aabbccddeeff', server_enabled: enabled, owner_customer_id: owned ? 7 : undefined }} onChanged={setEnabled} />;
}

describe('Exit server credentials', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('shows a newly issued key once and clears it on revocation', async () => {
    issue.mockResolvedValue({ token: 'server-only-secret' });
    revoke.mockResolvedValue({ status: 'ok' });
    const user = userEvent.setup();
    render(<Card />);
    await user.click(screen.getByRole('button', { name: 'serverRole.enable' }));
    expect(await screen.findByDisplayValue('server-only-secret')).toBeInTheDocument();
    expect(issue).toHaveBeenCalledWith({ mac: 'aabbccddeeff' });
    expect(screen.getByText('serverRole.server')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'serverRole.revoke' }));
    await waitFor(() => expect(screen.queryByDisplayValue('server-only-secret')).not.toBeInTheDocument());
    expect(revoke).toHaveBeenCalledWith({ mac: 'aabbccddeeff' });
    expect(screen.getByText('serverRole.device')).toBeInTheDocument();
  });

  it('keeps the device role when credential issuance fails', async () => {
    issue.mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    render(<Card />);
    await user.click(screen.getByRole('button', { name: 'serverRole.enable' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('serverRole.device')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not offer server credentials on customer-owned devices', () => {
    render(<Card owned />);
    expect(screen.getByText('serverRole.customerOwned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'serverRole.enable' })).not.toBeInTheDocument();
    expect(issue).not.toHaveBeenCalled();
  });

  it('shows only the role to a read-only operator', () => {
    vi.spyOn(user, 'can').mockReturnValue(false);
    render(<Card />);
    expect(screen.getByText('serverRole.device')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(issue).not.toHaveBeenCalled();
  });

  it('clears the old token when a rotation response is lost', async () => {
    issue.mockResolvedValueOnce({ token: 'previous-token' }).mockRejectedValueOnce(new Error('network error'));
    const events = userEvent.setup();
    render(<Card />);
    await events.click(screen.getByRole('button', { name: 'serverRole.enable' }));
    expect(await screen.findByDisplayValue('previous-token')).toBeInTheDocument();
    await events.click(screen.getByRole('button', { name: 'serverRole.rotate' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('previous-token')).not.toBeInTheDocument();
  });
});
