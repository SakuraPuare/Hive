import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { model_Node } from '@/src/generated/client';

const mockNodesList = vi.fn();
const mockNodeUpdate = vi.fn();

vi.mock('@/src/generated/client', () => ({
  AdminService: {
    nodesList: () => mockNodesList(),
    nodeUpdate: (args: unknown) => mockNodeUpdate(args),
    adminListAllSubscriptions: () => Promise.resolve([]),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: (p: Promise<unknown>) => p,
}));

vi.mock('@/lib/auth', () => ({
  useCurrentUser: () => ({ user: { can: () => true }, loading: false }),
}));

import Gateway from '@/pages/gateway';
import { TooltipProvider } from '@/components/ui/tooltip';

const gateway: model_Node = {
  mac: 'aabbccddeeff',
  hostname: 'test-gateway',
  gateway_enabled: true,
  gateway_direction: 'auto',
  gateway_upstream_mode: 'manual',
  exit_direction: 'overseas',
};

const upstreams: model_Node[] = [
  { mac: '112233445566', hostname: 'domestic-upstream', exit_direction: 'domestic' },
  { mac: '223344556677', hostname: 'overseas-upstream', exit_direction: 'overseas' },
  { mac: '334455667788', hostname: 'legacy-upstream' },
  { hostname: 'missing-mac-upstream', exit_direction: 'overseas' },
];

async function openCandidates(node: model_Node) {
  mockNodesList.mockResolvedValue([node, ...upstreams]);
  const user = userEvent.setup();
  render(<TooltipProvider><Gateway /></TooltipProvider>);
  const row = (await screen.findByText('test-gateway')).closest('tr')!;
  const upstreamCell = within(row).getAllByRole('cell')[5];
  await user.click(within(upstreamCell).getByRole('combobox'));
  // Query the portalled list rather than the table, which includes every node.
  const list = await screen.findByRole('listbox');
  return { user, list };
}

function expectCandidates(list: HTMLElement, required: 'domestic' | 'overseas') {
  const expected = required === 'domestic'
    ? ['domestic-upstream'] : ['overseas-upstream', 'legacy-upstream'];
  expect(within(list).getAllByRole('option').map((option) =>
    option.querySelector('span.truncate')?.textContent,
  )).toEqual(expected);
  expect(within(list).queryByText('test-gateway')).not.toBeInTheDocument();
  expect(within(list).queryByText('missing-mac-upstream')).not.toBeInTheDocument();
}

describe('Gateway upstream candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeUpdate.mockResolvedValue({});
  });

  it.each([
    { label: 'CN ignores its own overseas exit direction', country: 'CN', exit_direction: 'overseas', required: 'overseas' },
    { label: 'foreign country ignores its own domestic exit direction', country: 'US', exit_direction: 'domestic', required: 'domestic' },
    { label: 'normalizes the reported country', country: ' cn ', required: 'overseas' },
    { label: 'foreign override wins over CN', country: 'CN', country_override: ' jp ', required: 'domestic' },
    { label: 'CN override wins over foreign country', country: 'US', country_override: ' cn ', required: 'overseas' },
    { label: 'invalid override falls back to reported country', country: ' jp ', country_override: 'unknown', required: 'domestic' },
    { label: 'missing country defaults to domestic', required: 'overseas' },
    { label: 'invalid country defaults to domestic', country: 'unknown', required: 'overseas' },
    { label: 'non-letter country defaults to domestic', country: '1A', required: 'overseas' },
  ] as const)('auto: $label', async ({ label: _label, required, ...fields }) => {
    const { list } = await openCandidates({ ...gateway, ...fields });
    expectCandidates(list, required);
  });

  it.each([
    { gateway_direction: 'domestic', exit_direction: 'overseas', country: 'US', required: 'overseas' },
    { gateway_direction: 'overseas', exit_direction: 'domestic', country: 'CN', required: 'domestic' },
    { gateway_direction: 'global', exit_direction: 'domestic', country: 'US', required: 'overseas' },
    { gateway_direction: 'global', exit_direction: 'overseas', country: 'CN', required: 'domestic' },
    { gateway_direction: 'direct', exit_direction: 'domestic', country: 'US', required: 'overseas' },
    { gateway_direction: 'direct', exit_direction: 'overseas', country: 'CN', required: 'domestic' },
    { gateway_direction: 'global', exit_direction: ' DOMESTIC ', required: 'overseas' },
    { gateway_direction: 'direct', exit_direction: '', required: 'domestic' },
  ] as const)('$gateway_direction uses the complementary direction ($exit_direction)', async ({ required, ...fields }) => {
    const { list } = await openCandidates({ ...gateway, ...fields });
    expectCandidates(list, required);
  });

  it('selects the displayed domestic upstream for an auto gateway abroad', async () => {
    const { user, list } = await openCandidates({ ...gateway, country: 'CN', country_override: 'US' });
    expectCandidates(list, 'domestic');
    await user.click(within(list).getByRole('option', { name: /domestic-upstream/ }));
    await waitFor(() => {
      expect(mockNodeUpdate).toHaveBeenCalledWith({
        mac: gateway.mac,
        requestBody: { gateway_upstream_nodes: '112233445566' },
      });
    });
  });
});
