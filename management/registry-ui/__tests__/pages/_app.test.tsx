import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '@/pages/_app';
import { mockRouter } from '@/test/setup';

// Mock AppLayout and PortalLayout to detect which layout wraps the page
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: any) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock('@/components/portal/PortalLayout', () => ({
  PortalLayout: ({ children }: any) => <div data-testid="portal-layout">{children}</div>,
}));

function DummyPage() {
  return <div data-testid="page-content">Page</div>;
}

describe('_app.tsx layout routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps admin pages with AppLayout', () => {
    mockRouter.pathname = '/dashboard';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.queryByTestId('portal-layout')).not.toBeInTheDocument();
  });

  it('renders / without any layout', () => {
    mockRouter.pathname = '/';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.queryByTestId('app-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-layout')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('renders /login without any layout', () => {
    mockRouter.pathname = '/login';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.queryByTestId('app-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-layout')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('renders /portal/login without any layout', () => {
    mockRouter.pathname = '/portal/login';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.queryByTestId('app-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-layout')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('renders /portal/register without any layout', () => {
    mockRouter.pathname = '/portal/register';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.queryByTestId('app-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-layout')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('wraps /portal/dashboard with PortalLayout', () => {
    mockRouter.pathname = '/portal/dashboard';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.getByTestId('portal-layout')).toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.queryByTestId('app-layout')).not.toBeInTheDocument();
  });

  it('wraps /portal/plans with PortalLayout', () => {
    mockRouter.pathname = '/portal/plans';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.getByTestId('portal-layout')).toBeInTheDocument();
  });

  it('wraps /portal/orders with PortalLayout', () => {
    mockRouter.pathname = '/portal/orders';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.getByTestId('portal-layout')).toBeInTheDocument();
  });

  it('wraps /portal/tickets with PortalLayout', () => {
    mockRouter.pathname = '/portal/tickets';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.getByTestId('portal-layout')).toBeInTheDocument();
  });

  it('wraps /portal/tickets/[id] with PortalLayout', () => {
    mockRouter.pathname = '/portal/tickets/42';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.getByTestId('portal-layout')).toBeInTheDocument();
  });

  it('wraps /nodes (admin) with AppLayout', () => {
    mockRouter.pathname = '/nodes';
    render(<App Component={DummyPage} pageProps={{}} router={mockRouter as any} />);

    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('portal-layout')).not.toBeInTheDocument();
  });
});
