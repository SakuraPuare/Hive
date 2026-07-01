import React, { useCallback, useEffect, useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Plan, model_Line } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, MoreVertical, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import { useRouter } from 'next/router';


function formatTraffic(bytes: number, t: ReturnType<typeof useTranslations>): string {
  if (bytes === 0) return t('unlimited');
  return `${(bytes / (1024 ** 3)).toFixed(1)} ${t('gb')}`;
}

function formatPrice(cents: number, t: ReturnType<typeof useTranslations>): string {
  return `${(cents / 100).toFixed(2)} ${t('yuan')}`;
}

export default function PlansPage() {
  const t = useTranslations('plans');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('subscription:write') ?? false;

  // ── Plans list ──────────────────────────────────────────────────────
  const [plans, setPlans] = useState<model_Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPlans(await sessionApi(AdminService.adminListPlans()));
    } catch (e) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !user) { router.replace('/login'); return; }
    if (!authLoading && user && !user.can('subscription:read')) { router.replace('/dashboard'); return; }
    if (!authLoading && user) loadPlans();
  }, [authLoading, user, router, loadPlans]);

  // ── Create / Edit dialog ──────────────────────────────────────────
  const [editPlan, setEditPlan] = useState<model_Plan | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState('');
  const [formTraffic, setFormTraffic] = useState('0');
  const [formSpeed, setFormSpeed] = useState('0');
  const [formDevices, setFormDevices] = useState('1');
  const [formDuration, setFormDuration] = useState('30');
  const [formPrice, setFormPrice] = useState('0');
  const [formOrder, setFormOrder] = useState('0');
  const [formEnabled, setFormEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

  function openCreate() {
    setFormName(''); setFormTraffic('0'); setFormSpeed('0');
    setFormDevices('1'); setFormDuration('30'); setFormPrice('0');
    setFormOrder('0'); setFormEnabled(true); setFormError(''); setInvalidFields(new Set());
    setShowCreate(true);
  }

  function openEdit(p: model_Plan) {
    setFormName(p.name ?? '');
    setFormTraffic(String((p.traffic_limit ?? 0) / (1024 ** 3)));
    setFormSpeed(String(p.speed_limit ?? 0));
    setFormDevices(String(p.device_limit ?? 0));
    setFormDuration(String(p.duration_days ?? 0));
    setFormPrice(String((p.price ?? 0) / 100));
    setFormOrder(String(p.sort_order ?? 0));
    setFormEnabled(p.enabled ?? true);
    setFormError('');
    setInvalidFields(new Set());
    setEditPlan(p);
  }

  async function handleSave() {
    // ── Centralized numeric validation: reject NaN / out-of-range before POST ──
    const checks: { key: string; raw: string; min: number; integer: boolean }[] = [
      { key: 'traffic', raw: formTraffic, min: 0, integer: false },
      { key: 'speed', raw: formSpeed, min: 0, integer: true },
      { key: 'devices', raw: formDevices, min: 1, integer: true },
      { key: 'duration', raw: formDuration, min: 1, integer: true },
      { key: 'price', raw: formPrice, min: 0, integer: false },
      { key: 'order', raw: formOrder, min: 0, integer: true },
    ];
    const bad = new Set<string>();
    if (!formName.trim()) bad.add('name');
    for (const c of checks) {
      const n = c.integer ? parseInt(c.raw, 10) : parseFloat(c.raw);
      if (Number.isNaN(n) || n < c.min) bad.add(c.key);
    }
    if (bad.size > 0) {
      setInvalidFields(bad);
      setFormError(t('invalidInput'));
      return;
    }
    setInvalidFields(new Set());
    setSaving(true); setFormError('');
    const body = {
      name: formName,
      traffic_limit: Math.round(parseFloat(formTraffic) * (1024 ** 3)),
      speed_limit: parseInt(formSpeed, 10),
      device_limit: parseInt(formDevices, 10),
      duration_days: parseInt(formDuration, 10),
      price: Math.round(parseFloat(formPrice) * 100),
      sort_order: parseInt(formOrder, 10),
      enabled: formEnabled,
    };
    try {
      if (editPlan) {
        await sessionApi(AdminService.adminUpdatePlan({ id: editPlan.id!, requestBody: body }));
        setEditPlan(null);
        toast.success(t('updateSuccess'));
      } else {
        await sessionApi(AdminService.adminCreatePlan({ requestBody: body }));
        setShowCreate(false);
        toast.success(t('createSuccess'));
      }
      loadPlans();
    } catch (e) {
      setFormError(getErrorMessage(e, t('saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────
  const [deletePlan, setDeletePlan] = useState<model_Plan | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  function openDelete(p: model_Plan) {
    setDeleteError('');
    setDeletePlan(p);
  }

  async function handleDelete() {
    if (!deletePlan) return;
    setDeleting(true); setDeleteError('');
    try {
      await sessionApi(AdminService.adminDeletePlan({ id: deletePlan.id! }));
      toast.success(t('deleteSuccess', { name: deletePlan.name ?? '' }));
      setDeletePlan(null);
      loadPlans();
    } catch (e) {
      setDeleteError(getErrorMessage(e, t('deleteFailed')));
    } finally {
      setDeleting(false);
    }
  }

  // ── Lines dialog ──────────────────────────────────────────────────
  const [lineEditPlan, setLineEditPlan] = useState<model_Plan | null>(null);
  const [allLines, setAllLines] = useState<model_Line[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(new Set());
  const [savingLines, setSavingLines] = useState(false);
  const [saveLinesError, setSaveLinesError] = useState('');
  const [lineSearch, setLineSearch] = useState('');
  const [linesLoading, setLinesLoading] = useState(false);

  async function openLineEdit(p: model_Plan) {
    setLineEditPlan(p);
    setSaveLinesError('');
    setLineSearch('');
    setLinesLoading(true);
    try {
      const [lines, assigned] = await Promise.all([
        sessionApi(AdminService.adminListLines()),
        sessionApi(AdminService.adminGetPlanLines({ id: p.id! })),
      ]);
      setAllLines(lines);
      setSelectedLineIds(new Set(assigned));
    } catch {
      setAllLines([]);
      setSelectedLineIds(new Set());
    } finally {
      setLinesLoading(false);
    }
  }

  function toggleLine(id: number) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSaveLines() {
    if (!lineEditPlan) return;
    setSavingLines(true); setSaveLinesError('');
    try {
      await sessionApi(AdminService.adminSetPlanLines({ id: lineEditPlan.id!, requestBody: { lines: Array.from(selectedLineIds) } }));
      toast.success(t('linesSaveSuccess'));
      setLineEditPlan(null);
    } catch (e) {
      setSaveLinesError(getErrorMessage(e, t('linesSaveFailed')));
    } finally {
      setSavingLines(false);
    }
  }

  const filteredLines = allLines.filter(
    (l) => !lineSearch || (l.name ?? '').toLowerCase().includes(lineSearch.toLowerCase()) || (l.region ?? '').toLowerCase().includes(lineSearch.toLowerCase()),
  );

  // ── Auth guard ────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="size-8 animate-spin text-md-primary" aria-hidden="true" />
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }
  if (!user) return null;

  // ── Form dialog content ───────────────────────────────────────────
  const formDialog = (open: boolean, onClose: () => void, title: string) => (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent
        size="md"
        stickyHeaderFooter
        pending={saving}
        className="rounded-2xl border border-border bg-popover overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-600 text-foreground">{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          className="grid gap-5"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="plan-name" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
              {t('planName')} <span className="text-md-error" aria-hidden="true">*</span>
            </Label>
            <Input
              id="plan-name"
              autoFocus
              required
              aria-required="true"
              aria-invalid={invalidFields.has('name') || undefined}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="plan-traffic" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('trafficLimit')} ({t('gb')})</Label>
              <Input id="plan-traffic" type="number" min="0" step="0.1" inputMode="decimal"
                aria-describedby="plan-traffic-hint" aria-invalid={invalidFields.has('traffic') || undefined}
                value={formTraffic} onChange={(e) => setFormTraffic(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
              <span id="plan-traffic-hint" className="sr-only">{t('gb')}</span>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plan-speed" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('speedLimit')} ({t('mbps')})</Label>
              <Input id="plan-speed" type="number" min="0" step="1" inputMode="numeric"
                aria-describedby="plan-speed-hint" aria-invalid={invalidFields.has('speed') || undefined}
                value={formSpeed} onChange={(e) => setFormSpeed(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
              <span id="plan-speed-hint" className="sr-only">{t('mbps')}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="plan-devices" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('deviceLimit')}</Label>
              <Input id="plan-devices" type="number" min="1" step="1" inputMode="numeric"
                aria-invalid={invalidFields.has('devices') || undefined}
                value={formDevices} onChange={(e) => setFormDevices(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plan-duration" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('durationDays')}</Label>
              <Input id="plan-duration" type="number" min="1" step="1" inputMode="numeric"
                aria-invalid={invalidFields.has('duration') || undefined}
                value={formDuration} onChange={(e) => setFormDuration(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="plan-price" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('price')} ({t('yuan')})</Label>
              <Input id="plan-price" type="number" min="0" step="0.01" inputMode="decimal"
                aria-describedby="plan-price-hint" aria-invalid={invalidFields.has('price') || undefined}
                value={formPrice} onChange={(e) => setFormPrice(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
              <span id="plan-price-hint" className="sr-only">{t('yuan')}</span>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plan-order" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('sortOrder')}</Label>
              <Input id="plan-order" type="number" min="0" step="1" inputMode="numeric"
                aria-invalid={invalidFields.has('order') || undefined}
                value={formOrder} onChange={(e) => setFormOrder(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="plan-enabled" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colStatus')}</Label>
            <Switch
              id="plan-enabled"
              checked={formEnabled}
              onCheckedChange={setFormEnabled}
              onLabel={t('enabled')}
              offLabel={t('disabled')}
            />
          </div>
          {formError && (
            <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-md-error-container px-3 py-2 text-sm text-md-on-error-container">
              {formError}
            </p>
          )}
          {/* Hidden submit enables Enter-to-submit from any field while the visible Save lives in the sticky footer. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            loading={saving}
            disabled={!formName.trim()}
          >
            {saving ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const totalPlans = plans.length;
  const enabledPlans = plans.filter((p) => p.enabled).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">{t('title')}</h1>
          {!loading && totalPlans > 0 && (
            <p className="text-sm text-muted-foreground">
              {totalPlans} {t('title').toLowerCase()} &middot; {enabledPlans} {t('enabled').toLowerCase()}
            </p>
          )}
        </div>
        {canWrite && (
          <Button type="button" onClick={openCreate} className="shrink-0">
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('createPlan')}
          </Button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up">
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Plans table ── */}
      <Card className="bg-card border border-border rounded-xl overflow-hidden p-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-md-surface-container-high border-b border-border hover:bg-md-surface-container-high">
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colName')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colTraffic')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colSpeed')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colDevices')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colDuration')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colPrice')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colStatus')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colOrder')}</TableHead>
                {canWrite && <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('colActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 9 : 8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <svg className="animate-spin size-8 text-md-primary" viewBox="0 0 50 50" fill="none">
                        <circle cx="25" cy="25" r="20" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                          strokeDasharray="100 28" className="opacity-25" />
                        <path d="M25 5a20 20 0 0 1 20 20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                      </svg>
                      <span className="text-sm">{tCommon('loading')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : plans.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 9 : 8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex size-14 items-center justify-center rounded-2xl bg-md-surface-container-high">
                        <svg className="size-7 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 10h8M8 14h4" />
                        </svg>
                      </div>
                      <p className="text-sm text-muted-foreground">{t('noPlans')}</p>
                      {canWrite && (
                        <Button type="button" size="sm" onClick={openCreate} className="mt-1">
                          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          {t('createPlan')}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                plans.map((p, i) => (
                  <TableRow
                    key={p.id}
                    className="hover-state border-b border-border last:border-0 animate-slide-up"
                    style={{ animationDelay: `${i * 35}ms` }}
                  >
                    <TableCell className="px-4 py-3 font-display text-base font-600 text-foreground">{p.name}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-foreground">{formatTraffic(p.traffic_limit ?? 0, t)}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-foreground">{p.speed_limit ?? 0} {t('mbps')}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-foreground">{p.device_limit ?? 0}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-foreground">{p.duration_days ?? 0} {t('days')}</TableCell>
                    <TableCell className="px-4 py-3 font-display text-base font-600 text-foreground">{formatPrice(p.price ?? 0, t)}</TableCell>
                    <TableCell className="px-4 py-3">
                      <span className={[
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500',
                        p.enabled
                          ? 'bg-md-tertiary-container text-md-on-tertiary-container'
                          : 'bg-muted text-muted-foreground',
                      ].join(' ')}>
                        <span className={['size-1.5 rounded-full', p.enabled ? 'bg-md-tertiary' : 'bg-md-outline'].join(' ')} />
                        {p.enabled ? t('enabled') : t('disabled')}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">{p.sort_order ?? 0}</TableCell>
                    {canWrite && (
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => openEdit(p)}
                          >
                            {tCommon('edit')}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('moreActions', { name: p.name ?? '' })}
                              >
                                <MoreVertical className="size-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem size="comfortable" onSelect={() => openLineEdit(p)}>
                                {t('editLines')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                size="comfortable"
                                variant="destructive"
                                onSelect={() => openDelete(p)}
                              >
                                {tCommon('delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      {formDialog(showCreate, () => setShowCreate(false), t('createPlan'))}

      {/* Edit dialog */}
      {formDialog(!!editPlan, () => setEditPlan(null), t('editPlan'))}

      {/* Delete confirm */}
      <AlertDialog
        open={!!deletePlan}
        onOpenChange={(v) => { if (!v && !deleting) { setDeletePlan(null); setDeleteError(''); } }}
      >
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-md-error" aria-hidden="true" />
              {t('deletePlan')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletePlan && t('deleteConfirm', { name: deletePlan.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-md-error-container px-3 py-2 text-sm text-md-on-error-container">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={deleting}
              loadingLabel={tCommon('loading')}
              onClick={handleDelete}
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lines dialog */}
      <Dialog open={!!lineEditPlan} onOpenChange={(v) => { if (!v && !savingLines) setLineEditPlan(null); }}>
        <DialogContent
          size="md"
          stickyHeaderFooter
          pending={savingLines}
          className="rounded-2xl border border-border bg-popover overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600 text-foreground">{t('editLines')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              aria-label={tCommon('search')}
              placeholder={tCommon('search')}
              value={lineSearch}
              onValueChange={setLineSearch}
              debounceMs={250}
              clearable
              clearLabel={tCommon('clear')}
              startIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
              }
              className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary"
            />
            {!linesLoading && allLines.length > 0 && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t('selectedCount', { count: selectedLineIds.size })}
              </p>
            )}
            <div className="max-h-64 overflow-y-auto rounded-xl bg-md-surface-container-lowest border border-border space-y-0.5 p-1">
              {linesLoading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-muted-foreground" role="status" aria-live="polite">
                  <Loader2 className="size-5 animate-spin text-md-primary" aria-hidden="true" />
                  <span className="text-sm">{tCommon('loading')}</span>
                </div>
              ) : filteredLines.length === 0 ? (
                <p className="text-sm text-muted-foreground px-3 py-4 text-center">{tCommon('noData')}</p>
              ) : (
                filteredLines.map((l) => (
                  <label
                    key={l.id!}
                    htmlFor={`line-${l.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-md-surface-container-high transition-colors"
                  >
                    <Checkbox
                      id={`line-${l.id}`}
                      checked={selectedLineIds.has(l.id!)}
                      onCheckedChange={() => toggleLine(l.id!)}
                    />
                    <span className="text-sm text-foreground leading-snug">
                      {l.region && (
                        <span className="mr-1 rounded-md bg-md-secondary-container px-1.5 py-0.5 text-xs font-500 text-md-on-secondary-container">
                          {l.region}
                        </span>
                      )}
                      {l.name}
                    </span>
                  </label>
                ))
              )}
            </div>
            {saveLinesError && (
              <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-md-error-container px-3 py-2 text-sm text-md-on-error-container">
                {saveLinesError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLineEditPlan(null)} disabled={savingLines}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={handleSaveLines} loading={savingLines}>
              {savingLines ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
