import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const update = vi.fn();
const get = vi.fn();
vi.mock('@/src/generated/client', () => ({ AdminService: {
  nodeUpdate: (args: unknown) => update(args),
  nodeGet: (args: unknown) => get(args),
} }));
vi.mock('@/lib/openapi-session', () => ({ sessionApi: (p: Promise<unknown>) => p }));
import { NodeEditDialog } from '@/components/nodes/NodeEditDialog';

const node = { mac: 'aabbccddeeff', hostname: 'test-node', country: 'CN', country_override: 'JP', location: '🇨🇳 中国' };

describe('Node location editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({});
    get.mockResolvedValue(node);
  });

  it('edits the same country override as the gateway without rewriting legacy location', async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    render(<NodeEditDialog node={node} open onOpenChange={vi.fn()} onSaved={saved} />);
    const location = screen.getByRole('combobox', { name: 'nodeDetail.location' });
    expect(location).toHaveTextContent('🇯🇵 日本');
    expect(screen.queryByText('nodeDetail.countryOverride')).not.toBeInTheDocument();
    await user.click(location);
    await user.click(screen.getByRole('option', { name: /countryAutoOption/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'nodeDetail.saveChanges' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(node));
    expect(update.mock.calls[0][0].requestBody.country_override).toBe('');
    expect(update.mock.calls[0][0].requestBody).not.toHaveProperty('location');
  });
});
