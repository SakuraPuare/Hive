import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminService, type handler_enqueueCommandRequest, type model_DeviceCommand, type model_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { useCurrentUser } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Activity, Play, RotateCw, Settings2, Square } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const ACTIONS = ['reboot', 'resync', 'restart-xray', 'restart-mihomo', 'service-control'] as const;
const SERVICES = [
  'xray', 'xray-exporter', 'cloudflared', 'frpc', 'easytier', 'hive-mihomo',
  'hive-hotspot', 'hive-gateway', 'hive-firewall', 'hive-fail2ban',
  'nginx', 'tailscaled', 'warp-svc', 'hive-xray-sync.timer', 'hive-clash-sync.timer',
  'hive-command-agent.timer', 'hive-updater.timer',
] as const;
const SERVICE_GROUPS = [
  { key: 'proxy', services: ['xray', 'xray-exporter', 'cloudflared', 'frpc', 'easytier'] },
  { key: 'network', services: ['hive-mihomo', 'hive-hotspot', 'hive-gateway'] },
  { key: 'security', services: ['hive-firewall', 'hive-fail2ban'] },
  { key: 'system', services: ['nginx', 'tailscaled', 'warp-svc'] },
  { key: 'automation', services: ['hive-xray-sync.timer', 'hive-clash-sync.timer', 'hive-command-agent.timer', 'hive-updater.timer'] },
] as const;
const SERVICE_OPERATIONS = ['start', 'stop', 'restart', 'status'] as const;
const OPERATIONS = ['start', 'stop', 'restart', 'status'] as const;
const STATUSES = ['pending', 'sent', 'done', 'failed', 'expired'] as const;
type Action = typeof ACTIONS[number];
type Operation = typeof OPERATIONS[number];
type ServiceOperation = typeof SERVICE_OPERATIONS[number];
type ServiceState = { name?: string; active_state?: string; sub_state?: string; load_state?: string };
type ServiceSnapshot = { sampled_at?: string | null; services?: ServiceState[] };
type BatchEntry = { mac: string; command?: model_DeviceCommand; error?: string; missing?: boolean };
type Cancelable = Promise<unknown> & { cancel?: () => void };
type Session = { active: boolean; running: number; waiters: (() => void)[]; reads: Set<Cancelable> };

// Reads and writes share the same five-request budget, including overlapping poll/enqueue work.
async function request<T>(session: Session, start: () => Promise<T>, read = false): Promise<T | undefined> {
  while (session.active && session.running >= 5) {
    const { promise, resolve } = Promise.withResolvers<void>();
    session.waiters.push(resolve);
    await promise;
  }
  if (!session.active) return undefined;
  session.running++;
  let promise: Cancelable | undefined;
  try {
    promise = start() as Cancelable;
    if (read) session.reads.add(promise);
    return await sessionApi(promise as Promise<T>);
  } finally {
    if (promise) session.reads.delete(promise);
    session.running--;
    session.waiters.shift()?.();
  }
}

/** A keyed mount owns one target-list session; successful enqueue is not execution success. */
export function NodeCommandsDialog({ nodes, open, onOpenChange }: {
  nodes: model_Node[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('nodeCommands');
  const common = useTranslations('common');
  const fmt = useFormat();
  const { user } = useCurrentUser();
  const canRead = !!user?.can('node:read');
  const canWrite = !!user?.can('node:write');
  const [action, setAction] = useState<Action>('reboot');
  const [service, setService] = useState<string>('xray');
  const [operation, setOperation] = useState<Operation>('status');
  const [confirmation, setConfirmation] = useState<handler_enqueueCommandRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [batch, setBatch] = useState<BatchEntry[]>([]);
  const [history, setHistory] = useState<model_DeviceCommand[]>([]);
  const [pollErrors, setPollErrors] = useState<Record<string, string>>({});
  const [serviceSnapshot, setServiceSnapshot] = useState<ServiceSnapshot | null>(null);
  const [serviceError, setServiceError] = useState('');
  const [serviceNow, setServiceNow] = useState(() => Date.now());
  const sessionRef = useRef<Session | null>(null);
  const targetKey = nodes.map((node) => node.mac ?? '').join(',');
  const previousTarget = useRef(targetKey);

  useEffect(() => {
    const session: Session = { active: true, running: 0, waiters: [], reads: new Set() };
    sessionRef.current = session;
    busyRef.current = false;
    setBusy(false);
    if (previousTarget.current !== targetKey) {
      setBatch([]);
      setHistory([]);
      previousTarget.current = targetKey;
    }
    setPollErrors({});
    setConfirmation(null);
    let timer: number | undefined;
    const macs = targetKey.split(',').filter(Boolean);
    async function poll() {
      await Promise.all(macs.map(async (mac) => {
        try {
          const commands = await request(session, () => AdminService.adminListDeviceCommands({ mac }), true);
          if (!session.active || !commands) return;
          setPollErrors((previous) => { const next = { ...previous }; delete next[mac]; return next; });
          if (macs.length === 1) setHistory(commands);
          setBatch((previous) => previous.map((entry) => {
            if (entry.mac !== mac || entry.command?.id == null) return entry;
            const updated = commands.find((command) => command.id === entry.command!.id);
            return updated ? { ...entry, command: updated, missing: false } : { ...entry, missing: true };
          }));
        } catch (error) {
          if (session.active) setPollErrors((previous) => ({ ...previous, [mac]: getErrorMessage(error, t('historyFailed')) }));
        }
      }));
      if (session.active) timer = window.setTimeout(() => { void poll(); }, 2000);
    }
    if (open && canRead && macs.length) void poll();
    return () => {
      session.active = false;
      clearTimeout(timer);
      session.reads.forEach((promise) => promise.cancel?.());
      session.waiters.splice(0).forEach((resolve) => resolve());
    };
  }, [open, targetKey, canRead, t]);

  useEffect(() => {
    const mac = nodes.length === 1 ? nodes[0].mac : '';
    if (!open || !canRead || !mac) {
      setServiceSnapshot(null);
      setServiceError('');
      return;
    }
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const snapshot = await sessionApi(AdminService.adminDeviceServices({ mac }));
        if (stopped) return;
        setServiceSnapshot(snapshot);
        setServiceError('');
        setServiceNow(Date.now());
      } catch (error) {
        if (!stopped) setServiceError(getErrorMessage(error, t('serviceStatusUnavailable')));
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [open, canRead, targetKey, t]);

  function commandLabel(command: handler_enqueueCommandRequest | model_DeviceCommand) {
    const known = ACTIONS.find((value) => value === command.action);
    const label = known ? t(`action_${known}`) : command.action ?? t('unknown');
    return command.params ? `${label} · ${command.params}` : label;
  }

  async function dispatch(command: handler_enqueueCommandRequest) {
    const session = sessionRef.current;
    if (!session?.active || !open || !canWrite || busyRef.current || !nodes.length || nodes.some((node) => !node.mac)) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmation(null);
    setBatch(nodes.map((node) => ({ mac: node.mac! })));
    await Promise.all(nodes.map(async (node) => {
      const mac = node.mac!;
      try {
        const response = await request(session, () => AdminService.adminEnqueueDeviceCommand({ mac, requestBody: command }));
        if (!session.active || !response) return;
        if (!Number.isInteger(response.id) || response.id <= 0) throw new Error('Missing command id');
        setBatch((previous) => previous.map((entry) => entry.mac === mac
          ? { mac, command: { ...command, id: response.id, node_mac: mac, status: 'pending' } } : entry));
      } catch (error) {
        if (session.active) setBatch((previous) => previous.map((entry) => entry.mac === mac
          ? { mac, error: getErrorMessage(error, t('enqueueFailed')) } : entry));
      }
    }));
    if (session.active) { busyRef.current = false; setBusy(false); }
  }

  const actionOptions = nodes.length === 1
    ? ACTIONS.filter((value) => value !== 'service-control')
    : ACTIONS;
  const selected: handler_enqueueCommandRequest = {
    action,
    ...(action === 'service-control' ? { params: JSON.stringify({ service, operation }) } : {}),
  };
  const readOnly = action === 'service-control' && operation === 'status';
  const stopsAgent = action === 'service-control' && service === 'hive-command-agent.timer' && operation === 'stop';
  const serviceSampleTime = serviceSnapshot?.sampled_at ? Date.parse(serviceSnapshot.sampled_at) : NaN;
  const serviceStale = !Number.isFinite(serviceSampleTime) || serviceNow - serviceSampleTime > 150_000;
  const confirmationParams = (() => {
    if (!confirmation?.params) return null;
    try {
      return JSON.parse(confirmation.params) as { service?: string; operation?: string };
    } catch {
      return null;
    }
  })();
  const confirmationStopsAgent = confirmationParams?.service === 'hive-command-agent.timer' && confirmationParams.operation === 'stop';
  function runService(serviceName: string, operationName: ServiceOperation) {
    const command: handler_enqueueCommandRequest = {
      action: 'service-control',
      params: JSON.stringify({ service: serviceName, operation: operationName }),
    };
    if (operationName === 'status') {
      void dispatch(command);
    } else {
      setConfirmation(command);
    }
  }
  const statusLabel = (status?: string) => {
    const known = STATUSES.find((value) => value === status);
    return known ? t(`status_${known}`) : status ?? t('unknown');
  };
  const targets = (
    <ul className="space-y-1 text-sm">
      {nodes.map((node, index) => <li key={node.mac ?? index}>
        <span className="font-medium">{node.hostname || node.mac || t('unknown')}</span>{' '}
        <span className="font-mono">{node.mac || t('missingMac')}</span>
        {node.probe_status !== 'online' && <span className="ml-2 text-md-error">{t('offline')}</span>}
      </li>)}
    </ul>
  );
  const output = (command: model_DeviceCommand) => <>
    {command.params && <pre className="whitespace-pre-wrap break-all text-xs">{command.params}</pre>}
    {command.result && <pre className="whitespace-pre-wrap break-all rounded bg-md-surface-container-high p-2 text-xs">{command.result}</pre>}
  </>;

  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!busyRef.current) onOpenChange(next); }}>
      <DialogContent size="xl" pending={busy} closeLabel={common('close')} description={t('description')}>
        <DialogHeader><DialogTitle>{t('title')}</DialogTitle></DialogHeader>
        <section className="space-y-2"><h3 className="text-sm font-semibold">{t('targets')}</h3>{targets}</section>
        <p className="text-xs text-muted-foreground">{t('offlineNotice')}</p>
        {!canWrite && <p role="status" className="text-sm text-md-error">{t('writePermissionRequired')}</p>}
        {!canRead && <p role="status" className="text-sm text-md-error">{t('readPermissionRequired')}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">{t('command')}
            <select aria-label={t('command')} className="h-10 w-full rounded-md border bg-background px-2" value={action} disabled={busy || !canWrite} onChange={(event) => setAction(event.target.value as Action)}>
              {actionOptions.map((value) => <option key={value} value={value}>{t(`action_${value}`)}</option>)}
            </select>
          </label>
          {action === 'service-control' && <>
            <label className="space-y-1 text-sm">{t('service')}
              <select aria-label={t('service')} className="h-10 w-full rounded-md border bg-background px-2" value={service} disabled={busy || !canWrite} onChange={(event) => setService(event.target.value)}>
                {SERVICES.map((value) => <option key={value} value={value}>{t(`service_${value.replaceAll('.', '_')}`)} · {value}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">{t('operation')}
              <select aria-label={t('operation')} className="h-10 w-full rounded-md border bg-background px-2" value={operation} disabled={busy || !canWrite} onChange={(event) => setOperation(event.target.value as Operation)}>
                {OPERATIONS.map((value) => <option key={value} value={value}>{t(`operation_${value}`)}</option>)}
              </select>
            </label>
          </>}
        </div>
        {!readOnly && <p className="text-sm text-md-error">{t('disruptiveWarning')}</p>}
        {stopsAgent && <p role="alert" className="text-sm text-md-error">{t('agentStopWarning')}</p>}
        <Button disabled={busy || !canWrite || !nodes.length || nodes.some((node) => !node.mac)} loading={busy}
          onClick={() => { if (readOnly) void dispatch(selected); else setConfirmation(selected); }}>{t('send')}</Button>
        {nodes.length === 1 && canRead && <section className="space-y-3 border-t border-md-outline-variant pt-4" aria-labelledby="admin-service-controls-title">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-md-primary" aria-hidden="true" />
            <h3 id="admin-service-controls-title" className="text-sm font-600">{t('serviceControls')}</h3>
          </div>
          <p className="text-xs text-muted-foreground">{t('serviceControlsDesc')}</p>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {serviceError ? `${t('serviceStatusUnavailable')} · ${serviceError}` : serviceSnapshot?.sampled_at
              ? t('serviceStatusSample', { time: fmt.dateTime(serviceSnapshot.sampled_at) })
              : t('serviceStatusUnknown')}
            {serviceSnapshot?.sampled_at && serviceStale ? ` · ${t('serviceStatusStale')}` : ''}
          </p>
          <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
            {SERVICE_GROUPS.map((group) => (
              <div key={group.key} className="space-y-2">
                <p className="text-xs font-600 uppercase tracking-wide text-muted-foreground">{t(`serviceGroup_${group.key}`)}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.services.map((serviceName) => {
                    const state = serviceSnapshot?.services?.find((item) => item.name === serviceName);
                    const unknown = !!serviceError || serviceStale || !state;
                    const statusClass = unknown ? 'text-muted-foreground' : state.active_state === 'active' ? 'text-green-600' : state.active_state === 'failed' ? 'text-md-error' : 'text-muted-foreground';
                    return (
                      <div key={serviceName} className="rounded-lg border border-md-outline-variant bg-md-surface-container-low p-2.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-500">{t(`service_${serviceName.replaceAll('.', '_')}`)}</span>
                          <span className={`text-xs ${statusClass}`}>
                            {unknown ? t('serviceStatusUnknown') : state.load_state === 'not-found' ? t('serviceStatusNotFound') : state.sub_state === 'not-applicable' ? t('serviceStatusNotApplicable') : `${state.active_state} / ${state.sub_state}`}
                          </span>
                        </div>
                        {serviceName === 'hive-gateway' && state?.sub_state === 'not-applicable' && (
                          <p className="mb-2 text-xs text-muted-foreground">{t('serviceGatewayHotspotHint')}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {SERVICE_OPERATIONS.map((operationName) => {
                            const key = `${serviceName}:${operationName}`;
                            const Icon = operationName === 'start' ? Play : operationName === 'stop' ? Square : operationName === 'restart' ? RotateCw : Activity;
                            return (
                              <Button key={operationName} type="button" variant={operationName === 'restart' ? 'secondary' : 'ghost'} size="sm"
                                className="h-8 gap-1 px-2 text-xs" disabled={!canWrite || busy}
                                onClick={() => runService(serviceName, operationName)}
                                title={t(`serviceOp_${operationName}`)}>
                                <Icon className="size-3.5" aria-hidden="true" />
                                <span className="sr-only sm:not-sr-only">{t(`serviceOp_${operationName}`)}</span>
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>}
        {batch.length > 0 && <section className="space-y-2" aria-label={t('latestBatch')} aria-live="polite">
          <h3 className="text-sm font-semibold">{t('latestBatch')}</h3>
          <p className="text-xs text-muted-foreground">{t('queuedNotice')}</p>
          <ul className="space-y-2">{batch.map((entry) => <li key={entry.mac} className="space-y-1 rounded-lg border p-3 text-sm">
            <div className="font-mono">{entry.mac}</div>
            {entry.error ? <p role="alert" className="text-md-error">{t('enqueueFailed')}: {entry.error}</p>
              : entry.command ? <><p>#{entry.command.id} · {commandLabel(entry.command)} · {statusLabel(entry.command.status)}</p>{output(entry.command)}</>
                : <p>{t('enqueuing')}</p>}
            {entry.missing && <p className="text-xs text-muted-foreground">{t('notInHistory')}</p>}
          </li>)}</ul>
        </section>}
        {Object.entries(pollErrors).map(([mac, error]) => <p key={mac} role="status" className="text-sm text-md-error">{mac}: {t('historyFailed')} · {error}</p>)}
        {nodes.length === 1 && canRead && <section className="space-y-2" aria-label={t('history')}>
          <h3 className="text-sm font-semibold">{t('history')}</h3>
          {history.length === 0 ? <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
            : <ul className="max-h-64 space-y-2 overflow-y-auto">{history.map((command, index) => <li key={command.id ?? index} className="space-y-1 rounded-lg border p-3 text-sm">
              <p>#{command.id} · {commandLabel(command)} · {statusLabel(command.status)}</p>
              <p className="text-xs text-muted-foreground">{t('creator')}: {command.created_by || t('unknown')} · {t('createdAt')}: {fmt.dateTime(command.created_at)}</p>
              {output(command)}
            </li>)}</ul>}
        </section>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{common('close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={open && confirmation !== null} onOpenChange={(next) => { if (!next) setConfirmation(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="break-all text-sm font-semibold">{confirmation && commandLabel(confirmation)}</p>
        {targets}
        <p className="text-sm text-md-error">{t('disruptiveWarning')}</p>
        {confirmationStopsAgent && <p className="text-sm text-md-error">{t('agentStopWarning')}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{common('cancel')}</AlertDialogCancel>
          <AlertDialogAction destructive disabled={!canWrite} onClick={() => { if (confirmation) void dispatch(confirmation); }}>{t('confirmSend')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
