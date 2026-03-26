import React, { useCallback, useEffect, useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { main_Plan, main_Line } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import { useRouter } from 'next/router';


function formatTraffic(bytes: number, t: any): string {
  if (bytes === 0) return t('unlimited');
  return `${(bytes / (1024 ** 3)).toFixed(1)} ${t('gb')}`;
}

function formatPrice(cents: number, t: any): string {
  return `${(cents / 100).toFixed(2)} ${t('yuan')}`;
}

export default function PlansPage() {
  const t = useTranslations('plans');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('subscription:write') ?? false;

  // ── Plans list ──────────────────────────────────────────────────────
  const [plans, setPlans] = useState<main_Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPlans(await sessionApi(AdminService.adminListPlans()));
    } catch (e: any) {
      setError(e?.error || t('loadFailed'));
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
  const [editPlan, setEditPlan] = useState<main_Plan | null>(null);
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

  function openEdit(p: main_Plan) {
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
    } catch (e: any) {
      setFormError(e?.error || 'Error');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────
  const [deletePlan, setDeletePlan] = useState<main_Plan | null>(null);
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
  const [lineEditPlan, setLineEditPlan] = useState<main_Plan | null>(null);
  const [allLines, setAllLines] = useState<main_Line[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(new Set());
  const [savingLines, setSavingLines] = useState(false);
  const [saveLinesError, setSaveLinesError] = useState('');
  const [lineSearch, setLineSearch] = useState('');

  async function openLineEdit(p: main_Plan) {
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
    } catch (e: any) {
      setSaveLinesError(e?.error || 'Error');
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
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>{t('planName')}</Label>
            <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>{t('trafficLimit')} ({t('gb')})</Label>
              <Input type="number" min="0" step="0.1" value={formTraffic} onChange={(e) => setFormTraffic(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{t('speedLimit')} ({t('mbps')})</Label>
              <Input type="number" min="0" value={formSpeed} onChange={(e) => setFormSpeed(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>{t('deviceLimit')}</Label>
              <Input type="number" min="1" value={formDevices} onChange={(e) => setFormDevices(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{t('durationDays')}</Label>
              <Input type="number" min="1" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>{t('price')} ({t('yuan')})</Label>
              <Input type="number" min="0" step="0.01" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>{t('sortOrder')}</Label>
              <Input type="number" value={formOrder} onChange={(e) => setFormOrder(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label>{t('colStatus')}</Label>
            <Button
              type="button" variant="outline" size="sm"
              onClick={() => setFormEnabled(!formEnabled)}
            >
              {formEnabled ? t('enabled') : t('disabled')}
            </Button>
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tCommon('cancel')}</Button>
          <Button onClick={handleSave} disabled={saving || !formName.trim()}>
            {saving ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        {canWrite && <Button onClick={openCreate}>{t('createPlan')}</Button>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colTraffic')}</TableHead>
                <TableHead>{t('colSpeed')}</TableHead>
                <TableHead>{t('colDevices')}</TableHead>
                <TableHead>{t('colDuration')}</TableHead>
                <TableHead>{t('colPrice')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colOrder')}</TableHead>
                {canWrite && <TableHead>{t('colActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={canWrite ? 9 : 8} className="text-center py-8 text-muted-foreground">{tCommon('loading')}</TableCell></TableRow>
              ) : plans.length === 0 ? (
                <TableRow><TableCell colSpan={canWrite ? 9 : 8} className="text-center py-8 text-muted-foreground">{t('noPlans')}</TableCell></TableRow>
              ) : (
                plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{formatTraffic(p.traffic_limit ?? 0, t)}</TableCell>
                    <TableCell>{p.speed_limit ?? 0} {t('mbps')}</TableCell>
                    <TableCell>{p.device_limit ?? 0}</TableCell>
                    <TableCell>{p.duration_days ?? 0} {t('days')}</TableCell>
                    <TableCell>{formatPrice(p.price ?? 0, t)}</TableCell>
                    <TableCell>
                      <Badge variant={p.enabled ? 'default' : 'secondary'}>
                        {p.enabled ? t('enabled') : t('disabled')}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.sort_order ?? 0}</TableCell>
                    {canWrite && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>{tCommon('edit')}</Button>
                          <Button variant="ghost" size="sm" onClick={() => openLineEdit(p)}>{t('editLines')}</Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeletePlan(p)}>{tCommon('delete')}</Button>
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
        <DialogContent>
          <DialogHeader><DialogTitle>{t('deletePlan')}</DialogTitle></DialogHeader>
          <p>{deletePlan && t('deleteConfirm', { name: deletePlan.name })}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePlan(null)}>{tCommon('cancel')}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? tCommon('loading') : tCommon('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lines dialog */}
      <Dialog open={!!lineEditPlan} onOpenChange={(v) => { if (!v) setLineEditPlan(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('editLines')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder={tCommon('search')}
              value={lineSearch}
              onChange={(e) => setLineSearch(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredLines.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-1">{tCommon('noData')}</p>
              ) : (
                filteredLines.map((l) => (
                  <label
                    key={l.id!}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedLineIds.has(l.id!)}
                      onChange={() => toggleLine(l.id!)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">
                      {l.region ? `【${l.region}】` : ''}{l.name}
                    </span>
                  </label>
                ))
              )}
            </div>
            {saveLinesError && <p className="text-sm text-destructive">{saveLinesError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLineEditPlan(null)}>{tCommon('cancel')}</Button>
            <Button onClick={handleSaveLines} disabled={savingLines}>
              {savingLines ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
