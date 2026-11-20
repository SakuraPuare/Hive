import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { model_DeviceCommand, model_Node } from '@/src/generated/client';

const { enqueue, list, services, permissions } = vi.hoisted(() => ({
  enqueue: vi.fn(), list: vi.fn(), services: vi.fn(), permissions: { read: true, write: true },
}));
vi.mock('@/src/generated/client', () => ({ AdminService: {
  adminEnqueueDeviceCommand: enqueue,
  adminListDeviceCommands: list,
  adminDeviceServices: services,
} }));
vi.mock('@/lib/openapi-session', () => ({ sessionApi: (promise: Promise<unknown>) => promise }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => ({
  user: { can: (permission: string) => permission === 'node:read' ? permissions.read : permissions.write },
}) }));
import { NodeCommandsDialog } from '@/components/nodes/NodeCommandsDialog';

const nodes: model_Node[] = [
  { mac: 'aabbccddeeff', hostname: 'first-node', status: 'active', probe_status: 'online' },
  { mac: '112233445566', hostname: 'offline-node', status: 'active', probe_status: 'offline' },
  { mac: '778899aabbcc', hostname: 'third-node', status: 'active', probe_status: 'online' },
];

async function settle() {
  await act(async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); });
}

describe('NodeCommandsDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    enqueue.mockReset();
    list.mockReset().mockResolvedValue([]);
    services.mockReset().mockResolvedValue({
      sampled_at: new Date().toISOString(),
      services: [{ name: 'xray', active_state: 'active', sub_state: 'running', load_state: 'loaded' }],
    });
    permissions.read = true;
    permissions.write = true;
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('requires explicit confirmation with command and every target before a mutating write', async () => {
    render(<NodeCommandsDialog nodes={nodes} open onOpenChange={() => {}} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'nodeCommands.send' }));
    const confirmation = screen.getByRole('alertdialog');
    expect(within(confirmation).getByText('nodeCommands.action_reboot')).toBeInTheDocument();
    for (const node of nodes) expect(within(confirmation).getByText(node.mac!)).toBeInTheDocument();
    expect(enqueue).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'common.cancel' }));
    expect(enqueue).not.toHaveBeenCalled();
    expect(screen.getByText('nodeCommands.offline')).toBeInTheDocument();
  });

  it('keeps enqueue failures distinct from pending, failed and expired execution results without retrying writes', async () => {
    enqueue.mockImplementation(({ mac }) => mac === nodes[1].mac
      ? Promise.reject({ error: 'queue unavailable' }) : Promise.resolve({ id: mac === nodes[0].mac ? 11 : 33 }));
    render(<NodeCommandsDialog nodes={nodes} open onOpenChange={() => {}} />);
    await settle();
    fireEvent.change(screen.getByRole('combobox', { name: 'nodeCommands.command' }), { target: { value: 'service-control' } });
    fireEvent.click(screen.getByRole('button', { name: 'nodeCommands.send' }));
    await settle();
    const batch = screen.getByRole('region', { name: 'nodeCommands.latestBatch' });
    expect(within(batch).getByText(/queue unavailable/)).toBeInTheDocument();
    expect(within(batch).getAllByText(/nodeCommands.status_pending/)).toHaveLength(2);
    list.mockImplementation(({ mac }) => Promise.resolve(mac === nodes[0].mac
      ? [{ id: 11, action: 'service-control', status: 'failed', result: 'systemctl timed out' }]
      : [{ id: 33, action: 'service-control', status: 'expired' }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(within(batch).getByText(/nodeCommands.status_failed/)).toBeInTheDocument();
    expect(within(batch).getByText('systemctl timed out')).toBeInTheDocument();
    expect(within(batch).getByText(/nodeCommands.status_expired/)).toBeInTheDocument();
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  it('updates pending to done with actual params, output, creator and time and retains last known state outside latest history', async () => {
    enqueue.mockResolvedValue({ id: 42 });
    render(<NodeCommandsDialog nodes={[nodes[0]]} open onOpenChange={() => {}} />);
    await settle();
    fireEvent.change(screen.getByRole('combobox', { name: 'nodeCommands.command' }), { target: { value: 'service-control' } });
    expect(screen.getByRole('combobox', { name: 'nodeCommands.service' }).children).toHaveLength(18);
    fireEvent.click(screen.getByRole('button', { name: 'nodeCommands.send' }));
    await settle();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(enqueue).toHaveBeenCalledWith({ mac: nodes[0].mac, requestBody: {
      action: 'service-control', params: '{"service":"xray","operation":"status"}',
    } });
    const batch = screen.getByRole('region', { name: 'nodeCommands.latestBatch' });
    expect(within(batch).getByText(/nodeCommands.status_pending/)).toBeInTheDocument();
    list.mockResolvedValue([{ id: 42, action: 'service-control', status: 'done',
      params: '{"service":"xray","operation":"status"}', result: 'Active: active (running)',
      created_by: 'operator@example.test', created_at: '2026-11-19T12:00:00Z' }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(within(batch).getByText(/nodeCommands.status_done/)).toBeInTheDocument();
    expect(within(batch).getByText('Active: active (running)')).toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'nodeCommands.history' });
    expect(within(history).getByText(/operator@example.test/)).toHaveTextContent('nodeCommands.createdAt');
    expect(within(history).getByText('{"service":"xray","operation":"status"}')).toBeInTheDocument();
    list.mockResolvedValue([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(within(batch).getByText('nodeCommands.notInHistory')).toBeInTheDocument();
    expect(within(batch).getByText(/nodeCommands.status_done/)).toBeInTheDocument();
  });

  it('shows sampled service states and confirms mutating service actions', async () => {
    enqueue.mockResolvedValue({ id: 43 });
    render(<NodeCommandsDialog nodes={[nodes[0]]} open onOpenChange={() => {}} />);
    await settle();
    expect(services).toHaveBeenCalledWith({ mac: nodes[0].mac });
    expect(screen.getByText('active / running')).toBeInTheDocument();
    const card = screen.getByText('nodeCommands.service_xray').closest('div')!.parentElement!;
    fireEvent.click(within(card).getByRole('button', { name: 'nodeCommands.serviceOp_restart' }));
    const confirmation = screen.getByRole('alertdialog');
    expect(within(confirmation).getByText(/"service":"xray","operation":"restart"/)).toBeInTheDocument();
    expect(enqueue).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'common.cancel' }));
    fireEvent.click(within(card).getByRole('button', { name: 'nodeCommands.serviceOp_status' }));
    await settle();
    expect(enqueue).toHaveBeenCalledWith({ mac: nodes[0].mac, requestBody: {
      action: 'service-control', params: '{"service":"xray","operation":"status"}',
    } });
  });

  it('cancels reads on close and unmount and ignores late responses after a target switch', async () => {
    const old = Promise.withResolvers<model_DeviceCommand[]>();
    const cancel = vi.fn();
    list.mockReturnValueOnce(Object.assign(old.promise, { cancel })).mockResolvedValue([{ id: 8, action: 'resync', status: 'pending' }]);
    const view = render(<NodeCommandsDialog nodes={[nodes[0]]} open onOpenChange={() => {}} />);
    await settle();
    view.rerender(<NodeCommandsDialog nodes={[nodes[1]]} open onOpenChange={() => {}} />);
    await settle();
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => { old.resolve([{ id: 99, result: 'stale target output' }]); });
    expect(screen.queryByText('stale target output')).not.toBeInTheDocument();
    view.rerender(<NodeCommandsDialog nodes={[nodes[1]]} open={false} onOpenChange={() => {}} />);
    const count = list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(list).toHaveBeenCalledTimes(count);
    const late = Promise.withResolvers<model_DeviceCommand[]>();
    const unmountCancel = vi.fn();
    list.mockReturnValueOnce(Object.assign(late.promise, { cancel: unmountCancel }));
    view.rerender(<NodeCommandsDialog nodes={[nodes[1]]} open onOpenChange={() => {}} />);
    await settle();
    view.unmount();
    expect(unmountCancel).toHaveBeenCalledOnce();
    await act(async () => { late.resolve([{ id: 100, result: 'late unmount output' }]); await vi.advanceTimersByTimeAsync(6000); });
    expect(list).toHaveBeenCalledTimes(count + 1);
  });

  it('prevents closing while enqueue is in flight and ignores its late result after unmount', async () => {
    const write = Promise.withResolvers<Record<string, number>>();
    enqueue.mockReturnValue(write.promise);
    const onOpenChange = vi.fn();
    const view = render(<NodeCommandsDialog nodes={[nodes[0]]} open onOpenChange={onOpenChange} />);
    await settle();
    fireEvent.change(screen.getByRole('combobox', { name: 'nodeCommands.command' }), { target: { value: 'service-control' } });
    fireEvent.click(screen.getByRole('button', { name: 'nodeCommands.send' }));
    expect(screen.getAllByRole('button', { name: 'common.close' }).every((button) => button.hasAttribute('disabled'))).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(onOpenChange).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => { write.resolve({ id: 55 }); });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('shares a maximum of five active requests across overlapping history reads and writes', async () => {
    let active = 0;
    let maximum = 0;
    const pending: (() => void)[] = [];
    function tracked<T>(value: T) {
      const deferred = Promise.withResolvers<T>();
      active++;
      maximum = Math.max(maximum, active);
      pending.push(() => { active--; deferred.resolve(value); });
      return deferred.promise;
    }
    list.mockImplementation(() => tracked([]));
    enqueue.mockImplementation(() => tracked({ id: 5 }));
    const many = Array.from({ length: 12 }, (_, index) => ({ mac: `mac-${index}`, status: 'active', probe_status: 'online' }));
    render(<NodeCommandsDialog nodes={many} open onOpenChange={() => {}} />);
    await settle();
    expect(list).toHaveBeenCalledTimes(5);
    fireEvent.change(screen.getByRole('combobox', { name: 'nodeCommands.command' }), { target: { value: 'service-control' } });
    fireEvent.click(screen.getByRole('button', { name: 'nodeCommands.send' }));
    expect(enqueue).not.toHaveBeenCalled();
    while (pending.length) {
      await act(async () => { pending.shift()!(); });
      await settle();
    }
    expect(list).toHaveBeenCalledTimes(12);
    expect(enqueue).toHaveBeenCalledTimes(12);
    expect(maximum).toBe(5);
  });

  it('allows node readers to inspect history but never dispatch without node:write', async () => {
    permissions.write = false;
    list.mockResolvedValue([{ id: 7, created_by: 'reader-visible', action: 'resync', status: 'done' }]);
    render(<NodeCommandsDialog nodes={[nodes[0]]} open onOpenChange={() => {}} />);
    await settle();
    expect(screen.getByText(/reader-visible/)).toBeInTheDocument();
    expect(screen.getByText('nodeCommands.writePermissionRequired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nodeCommands.send' })).toBeDisabled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
