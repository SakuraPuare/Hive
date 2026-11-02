import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const mockListPlans = vi.fn();
const mockListLines = vi.fn();
const mockGetPlanLines = vi.fn();
const mockSetPlanLines = vi.fn();
const mockCreatePlan = vi.fn();
const mockUpdatePlan = vi.fn();
const mockDeletePlan = vi.fn();

vi.mock('@/src/generated/client', () => ({
  AdminService: {
    adminListPlans: () => mockListPlans(),
    adminListLines: () => mockListLines(),
    adminGetPlanLines: (...args: unknown[]) => mockGetPlanLines(...args),
    adminSetPlanLines: (...args: unknown[]) => mockSetPlanLines(...args),
    adminCreatePlan: (...args: unknown[]) => mockCreatePlan(...args),
    adminUpdatePlan: (...args: unknown[]) => mockUpdatePlan(...args),
    adminDeletePlan: (...args: unknown[]) => mockDeletePlan(...args),
  },
}));

vi.mock('@/lib/openapi-session', () => ({
  sessionApi: (p: Promise<any>) => p,
  apiUrl: (path: string) => `/api${path}`,
}));

// One stable object: the page reloads whenever the `user` reference changes,
// so a fresh object per call would spin the load effect forever.
const mockUser = {
  id: 1,
  username: 'admin',
  roles: ['superadmin'],
  permissions: ['plan:read', 'plan:write'],
  can: (perm: string) => ['plan:read', 'plan:write'].includes(perm),
};

vi.mock('@/lib/auth', () => ({
  useCurrentUser: () => ({ user: mockUser, loading: false }),
}));

import PlansPage from '@/pages/plans';

const mockPlan = {
  id: 1,
  name: 'test',
  traffic_limit: 107374182400,
  speed_limit: 0,
  device_limit: 1,
  duration_days: 30,
  price: 0,
  sort_order: 0,
  enabled: true,
};

function renderPage() {
  return render(
    <TooltipProvider>
      <PlansPage />
    </TooltipProvider>,
  );
}

describe('Plans page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPlans.mockResolvedValue([mockPlan]);
    mockListLines.mockResolvedValue([]);
    mockGetPlanLines.mockResolvedValue([]);
    mockSetPlanLines.mockResolvedValue({});
  });

  it('renders the plan table', async () => {
    renderPage();

    expect(await screen.findByText('test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'plans.createPlan' })).toBeInTheDocument();
  });

  // GET /admin/lines returns `null` (not `[]`) when the registry has no lines.
  // The lines dialog stored that straight into state and then called
  // allLines.filter(...), which threw and took the whole page down with
  // "Application error: a client-side exception has occurred".
  it('opens the lines dialog when the lines endpoint returns null', async () => {
    mockListLines.mockResolvedValue(null);
    mockGetPlanLines.mockResolvedValue(null);
    renderPage();

    const trigger = await screen.findByRole('button', { name: 'plans.moreActions' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'plans.editLines' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockListLines).toHaveBeenCalled();
  });
});
