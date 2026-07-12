import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { PortalService } from '@/src/generated/client';
import type { model_Node, model_DeviceCommand } from '@/src/generated/client';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshCw, Plus, Router as RouterIcon, AlertCircle, InboxIcon } from 'lucide-react';

// 白名单命令动作（与后端 commandActions 一致）。
const COMMAND_ACTIONS = ['reboot', 'restart-xray', 'restart-mihomo', 'resync'] as const;

// 命令状态 → chip 样式。pending/sent=进行中，done=成功，failed/expired=失败。
function CommandStatusChip({ status }: { status?: string }) {
  const t = useTranslations('portal');
  const s = status || 'pending';
  const label = t(`cmdStatus_${s}` as 'cmdStatus_pending');
  const tone =
    s === 'done' ? 'bg-md-primary-container text-md-on-primary-container'
      : s === 'failed' || s === 'expired' ? 'bg-md-error-container text-md-on-error-container'
        : 'bg-md-secondary-container text-md-on-secondary-container';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${tone}`}>
      {label}
    </span>
  );
}

export default function PortalDevicesPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { customer, loading: authLoading } = useCustomer();
  const fmt = useFormat();
  const toast = useToast();

  const [devices, setDevices] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 认领对话框
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimCode, setClaimCode] = useState('');
  const [claiming, setClaiming] = useState(false);

  // 命令对话框（针对某台设备）
  const [cmdDevice, setCmdDevice] = useState<model_Node | null>(null);
  const [cmdAction, setCmdAction] = useState<string>('resync');
  const [cmdHistory, setCmdHistory] = useState<model_DeviceCommand[]>([]);
  const [cmdSending, setCmdSending] = useState(false);

  // 解绑确认
  const [unbindDevice, setUnbindDevice] = useState<model_Node | null>(null);
  const [unbinding, setUnbinding] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalListDevices());
      setDevices(data ?? []);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) loadDevices();
  }, [authLoading, customer, router, loadDevices]);

  const submitClaim = useCallback(async () => {
    const code = claimCode.trim();
    if (!code) return;
    setClaiming(true);
    try {
      await portalSessionApi(PortalService.portalClaimDevice({ requestBody: { code } }));
      toast.success(t('claimSuccess'));
      setClaimOpen(false);
      setClaimCode('');
      loadDevices();
    } catch (e) {
      toast.error(getErrorMessage(e, t('claimFailed')));
    } finally {
      setClaiming(false);
    }
  }, [claimCode, t, toast, loadDevices]);

  const openCommands = useCallback(async (device: model_Node) => {
    setCmdDevice(device);
    setCmdAction('resync');
    setCmdHistory([]);
    try {
      const h = await portalSessionApi(PortalService.portalListDeviceCommands({ mac: device.mac! }));
      setCmdHistory(h ?? []);
    } catch {
      // 历史加载失败不阻塞下发
    }
  }, []);

  const sendCommand = useCallback(async () => {
    if (!cmdDevice) return;
    setCmdSending(true);
    try {
      await portalSessionApi(PortalService.portalEnqueueDeviceCommand({
        mac: cmdDevice.mac!,
        requestBody: { action: cmdAction },
      }));
      toast.success(t('cmdQueued'));
      const h = await portalSessionApi(PortalService.portalListDeviceCommands({ mac: cmdDevice.mac! }));
      setCmdHistory(h ?? []);
    } catch (e) {
      toast.error(getErrorMessage(e, t('cmdFailed')));
    } finally {
      setCmdSending(false);
    }
  }, [cmdDevice, cmdAction, t, toast]);

  const confirmUnbind = useCallback(async () => {
    if (!unbindDevice) return;
    setUnbinding(true);
    try {
      await portalSessionApi(PortalService.portalUnbindDevice({ mac: unbindDevice.mac! }));
      toast.success(t('unbindSuccess'));
      setUnbindDevice(null);
      loadDevices();
    } catch (e) {
      toast.error(getErrorMessage(e, t('unbindFailed')));
    } finally {
      setUnbinding(false);
    }
  }, [unbindDevice, t, toast, loadDevices]);

  if (authLoading) return (
    <div className="flex items-center justify-center py-24" role="status" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center gap-4">
        <div className="size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </div>
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        icon={<RouterIcon />}
        title={t('devicesTitle')}
        description={t('devicesDesc')}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={loadDevices} loading={loading} className="gap-2">
              {!loading && <RefreshCw className="size-4" aria-hidden="true" />}
              {tCommon('refresh')}
            </Button>
            <Button onClick={() => setClaimOpen(true)} className="gap-2">
              <Plus className="size-4" aria-hidden="true" />
              {t('claimDevice')}
            </Button>
          </div>
        }
      />

      {error && (
        <div role="alert" aria-live="assertive"
          className="flex items-center gap-3 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {!loading && devices.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <InboxIcon className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t('devicesEmpty')}</p>
          <Button onClick={() => setClaimOpen(true)} className="gap-2">
            <Plus className="size-4" aria-hidden="true" />
            {t('claimDevice')}
          </Button>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table aria-label={t('devicesTitle')}>
              <TableHeader>
                <TableRow className="border-b bg-md-surface-container-high/50">
                  <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">{t('colHostname')}</TableHead>
                  <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">{t('colMac')}</TableHead>
                  <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">{t('colStatus')}</TableHead>
                  <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">{t('colClaimedAt')}</TableHead>
                  <TableHead scope="col" className="text-right text-xs font-500 uppercase tracking-wide text-muted-foreground">{tCommon('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.mac} className="border-b last:border-0">
                    <TableCell className="font-500">{d.hostname || '—'}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{d.mac}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 text-sm ${d.status === 'active' ? 'text-md-primary' : 'text-muted-foreground'}`}>
                        <span className={`size-1.5 rounded-full ${d.status === 'active' ? 'bg-md-primary' : 'bg-muted-foreground'}`} aria-hidden="true" />
                        {d.status || t('notAvailable')}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.claimed_at ? fmt.dateTime(d.claimed_at) : '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openCommands(d)}>{t('cmdManage')}</Button>
                        <Button variant="ghost" size="sm" className="text-md-error hover:bg-md-error/10" onClick={() => setUnbindDevice(d)}>{t('unbind')}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* 认领设备对话框 */}
      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('claimDevice')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('claimHint')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="claim-code">{t('claimCodeLabel')}</Label>
              <Input
                id="claim-code"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value)}
                placeholder="XXXX-XXXX"
                className="font-mono uppercase"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClaimOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={submitClaim} loading={claiming} disabled={!claimCode.trim()}>{t('claimSubmit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 远程命令对话框 */}
      <Dialog open={!!cmdDevice} onOpenChange={(o) => { if (!o) setCmdDevice(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('cmdTitle', { name: cmdDevice?.hostname || cmdDevice?.mac || '' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {COMMAND_ACTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setCmdAction(a)}
                  className={`rounded-full px-3 py-1.5 text-sm font-500 transition-colors ${cmdAction === a ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-container-high text-foreground hover:bg-md-surface-container-highest'}`}
                >
                  {t(`cmdAction_${a}` as 'cmdAction_reboot')}
                </button>
              ))}
            </div>
            <Button onClick={sendCommand} loading={cmdSending} className="w-full">{t('cmdSend')}</Button>

            <div>
              <p className="mb-2 text-xs font-500 uppercase tracking-wide text-muted-foreground">{t('cmdHistory')}</p>
              {cmdHistory.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t('cmdHistoryEmpty')}</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {cmdHistory.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg bg-md-surface-container-high/50 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <span className="font-mono">{t(`cmdAction_${c.action}` as 'cmdAction_reboot')}</span>
                        <span className="text-xs text-muted-foreground">{c.created_at ? fmt.dateTime(c.created_at) : ''}</span>
                      </span>
                      <CommandStatusChip status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 解绑确认 */}
      <AlertDialog open={!!unbindDevice} onOpenChange={(o) => { if (!o) setUnbindDevice(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unbindConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('unbindConfirmDesc', { name: unbindDevice?.hostname || unbindDevice?.mac || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnbind} disabled={unbinding} className="bg-md-error text-md-on-error hover:bg-md-error/90">
              {t('unbind')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
