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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

  function openCreate() {
    setFormName(''); setFormTraffic('0'); setFormSpeed('0');
    setFormDevices('1'); setFormDuration('30'); setFormPrice('0');
    setFormOrder('0'); setFormEnabled(true); setFormError('');
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
    setEditPlan(p);
  }

  async function handleSave() {
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
      } else {
        await sessionApi(AdminService.adminCreatePlan({ requestBody: body }));
        setShowCreate(false);
      }
      loadPlans();
    } catch (e) {
      setFormError(getErrorMessage(e, 'Error'));
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────
  const [deletePlan, setDeletePlan] = useState<model_Plan | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!deletePlan) return;
    setDeleting(true);
    try {
      await sessionApi(AdminService.adminDeletePlan({ id: deletePlan.id! }));
      setDeletePlan(null);
      loadPlans();
    } catch {
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

  async function openLineEdit(p: model_Plan) {
    setLineEditPlan(p);
    setSaveLinesError('');
    setLineSearch('');
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
      setLineEditPlan(null);
    } catch (e) {
      setSaveLinesError(getErrorMessage(e, 'Error'));
    } finally {
      setSavingLines(false);
    }
  }

  const filteredLines = allLines.filter(
    (l) => !lineSearch || (l.name ?? '').toLowerCase().includes(lineSearch.toLowerCase()) || (l.region ?? '').toLowerCase().includes(lineSearch.toLowerCase()),
  );

  // ── Auth guard ────────────────────────────────────────────────────
  if (authLoading || !user) return null;

  // ── Form dialog content ───────────────────────────────────────────
  const formDialog = (open: boolean, onClose: () => void, title: string) => (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="rounded-2xl border border-border bg-popover p-0 gap-0 overflow-hidden animate-scale-in">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="font-display text-xl font-600 text-foreground">{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 px-6 py-5">
          <div className="grid gap-1.5">
            <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('planName')}</Label>
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('trafficLimit')} ({t('gb')})</Label>
              <Input type="number" min="0" step="0.1" value={formTraffic} onChange={(e) => setFormTraffic(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('speedLimit')} ({t('mbps')})</Label>
              <Input type="number" min="0" value={formSpeed} onChange={(e) => setFormSpeed(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('deviceLimit')}</Label>
              <Input type="number" min="1" value={formDevices} onChange={(e) => setFormDevices(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('durationDays')}</Label>
              <Input type="number" min="1" value={formDuration} onChange={(e) => setFormDuration(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('price')} ({t('yuan')})</Label>
              <Input type="number" min="0" step="0.01" value={formPrice} onChange={(e) => setFormPrice(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('sortOrder')}</Label>
              <Input type="number" value={formOrder} onChange={(e) => setFormOrder(e.target.value)}
                className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colStatus')}</Label>
            <button
              type="button"
              onClick={() => setFormEnabled(!formEnabled)}
              className={[
                'state-layer inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-500 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2',
                formEnabled
                  ? 'bg-md-tertiary-container text-md-on-tertiary-container'
                  : 'bg-muted text-muted-foreground',
              ].join(' ')}
            >
              <span className={['size-1.5 rounded-full', formEnabled ? 'bg-md-tertiary' : 'bg-md-outline'].join(' ')} />
              {formEnabled ? t('enabled') : t('disabled')}
            </button>
          </div>
          {formError && (
            <p className="flex items-center gap-1.5 rounded-lg bg-md-error-container px-3 py-2 text-sm text-md-on-error-container">
              {formError}
            </p>
          )}
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="state-layer inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500 border border-border bg-transparent text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !formName.trim()}
            className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 transition-shadow hover:elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin size-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                {tCommon('saving')}
              </span>
            ) : tCommon('save')}
          </button>
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
          <button
            type="button"
            onClick={openCreate}
            className="state-layer ripple inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 transition-shadow hover:elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('createPlan')}
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up">
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                        <svg className="size-7 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 10h8M8 14h4" />
                        </svg>
                      </div>
                      <p className="text-sm text-muted-foreground">{t('noPlans')}</p>
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
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="state-layer inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-500 text-md-primary bg-md-primary-container/50 hover:bg-md-primary-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                          >
                            {tCommon('edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => openLineEdit(p)}
                            className="state-layer inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-500 text-foreground bg-muted/50 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                          >
                            {t('editLines')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletePlan(p)}
                            className="state-layer inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-500 text-destructive bg-md-error-container/40 hover:bg-md-error-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1"
                          >
                            {tCommon('delete')}
                          </button>
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
      <Dialog open={!!deletePlan} onOpenChange={(v) => { if (!v) setDeletePlan(null); }}>
        <DialogContent className="rounded-2xl border border-border bg-popover p-0 gap-0 overflow-hidden animate-scale-in">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="font-display text-xl font-600 text-foreground">{t('deletePlan')}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5">
            <p className="text-sm text-foreground leading-relaxed">
              {deletePlan && t('deleteConfirm', { name: deletePlan.name ?? '' })}
            </p>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border flex gap-2">
            <button
              type="button"
              onClick={() => setDeletePlan(null)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500 border border-border bg-transparent text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-500 bg-md-error text-md-on-error elevation-1 transition-shadow hover:elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin size-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  {tCommon('loading')}
                </span>
              ) : tCommon('delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lines dialog */}
      <Dialog open={!!lineEditPlan} onOpenChange={(v) => { if (!v) setLineEditPlan(null); }}>
        <DialogContent className="rounded-2xl border border-border bg-popover p-0 gap-0 overflow-hidden animate-scale-in">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="font-display text-xl font-600 text-foreground">{t('editLines')}</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5 space-y-3">
            <Input
              placeholder={tCommon('search')}
              value={lineSearch}
              onChange={(e) => setLineSearch(e.target.value)}
              className="rounded-lg bg-muted border-border focus-visible:ring-2 focus-visible:ring-md-primary"
            />
            <div className="max-h-64 overflow-y-auto rounded-xl bg-md-surface-container-lowest border border-border space-y-0.5 p-1">
              {filteredLines.length === 0 ? (
                <p className="text-sm text-muted-foreground px-3 py-4 text-center">{tCommon('noData')}</p>
              ) : (
                filteredLines.map((l) => (
                  <label
                    key={l.id!}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-md-surface-container-high transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedLineIds.has(l.id!)}
                      onChange={() => toggleLine(l.id!)}
                      className="h-4 w-4 accent-md-primary rounded"
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
              <p className="flex items-center gap-1.5 rounded-lg bg-md-error-container px-3 py-2 text-sm text-md-on-error-container">
                {saveLinesError}
              </p>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border flex gap-2">
            <button
              type="button"
              onClick={() => setLineEditPlan(null)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500 border border-border bg-transparent text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveLines}
              disabled={savingLines}
              className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 transition-shadow hover:elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {savingLines ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin size-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  {tCommon('saving')}
                </span>
              ) : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
