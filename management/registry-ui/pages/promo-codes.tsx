import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_PromoCode } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Plus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';


function formatDate(s: string) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

const emptyForm = { code: '', discount_pct: '', discount_amt: '', max_uses: '', valid_from: '', valid_to: '', enabled: true };

type FormState = typeof emptyForm;

function PromoForm({ form, setForm, t }: { form: FormState; setForm: (f: FormState) => void; t: (k: string) => string }) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('code')}</Label>
        <Input
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          className="rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('discountPct')}</Label>
          <Input type="number" value={form.discount_pct} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} placeholder="0-100"
            className="rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('discountAmt')}</Label>
          <Input type="number" value={form.discount_amt} onChange={(e) => setForm({ ...form, discount_amt: e.target.value })} placeholder="0"
            className="rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('maxUses')}</Label>
        <Input type="number" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="0 = unlimited"
          className="rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('validFrom')}</Label>
          <Input type="datetime-local" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
            className="rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('validTo')}</Label>
          <Input type="datetime-local" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
            className="rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary" />
        </div>
      </div>
      <label htmlFor="pc-enabled" className="flex items-center gap-3 rounded-xl px-4 py-3 bg-md-surface-container cursor-pointer hover:bg-md-surface-container-high transition-colors">
        <input
          type="checkbox"
          id="pc-enabled"
          aria-label={t('enabled')}
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="h-4 w-4 accent-[hsl(var(--md-primary))] rounded"
        />
        <span className="text-sm font-medium text-foreground">{t('enabled')}</span>
      </label>
    </div>
  );
}

export default function PromoCodesPage() {
  const t = useTranslations('promoCodes');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('order:write') ?? false;

  const [codes, setCodes] = useState<model_PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCodes = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await sessionApi(AdminService.adminListPromoCodes());
      setCodes(Array.isArray(data) ? data : []);
    } catch (e: unknown) { setError(getErrorMessage(e, t('loadFailed'))); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { if (!authLoading && user?.can('order:write')) loadCodes(); }, [authLoading, user, loadCodes]);
  useEffect(() => { if (!authLoading && user && !user.can('order:write')) router.replace('/dashboard'); }, [authLoading, user, router]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleCreate() {
    setCreating(true); setCreateError('');
    try {
      await sessionApi(AdminService.adminCreatePromoCode({ requestBody: {
        code: createForm.code,
        discount_pct: parseFloat(createForm.discount_pct) || 0,
        discount_amt: parseInt(createForm.discount_amt) || 0,
        max_uses: parseInt(createForm.max_uses) || 0,
        valid_from: createForm.valid_from || undefined,
        valid_to: createForm.valid_to || undefined,
        enabled: createForm.enabled,
      }}));
      setCreateOpen(false); loadCodes();
    } catch (e: unknown) { setCreateError(getErrorMessage(e, t('createFailed'))); }
    finally { setCreating(false); }
  }

  const [editTarget, setEditTarget] = useState<model_PromoCode | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');

  function openEdit(pc: model_PromoCode) {
    setEditTarget(pc);
    setEditForm({ code: pc.code ?? '', discount_pct: String(pc.discount_pct ?? 0), discount_amt: String(pc.discount_amt ?? 0),
      max_uses: String(pc.max_uses ?? 0), valid_from: pc.valid_from?.slice(0,16) ?? '', valid_to: pc.valid_to?.slice(0,16) ?? '', enabled: pc.enabled ?? false });
    setEditError('');
  }

  async function handleEdit() {
    if (!editTarget) return;
    setEditing(true); setEditError('');
    try {
      await sessionApi(AdminService.adminUpdatePromoCode({ id: editTarget.id!, requestBody: {
        code: editForm.code,
        discount_pct: parseFloat(editForm.discount_pct) || 0,
        discount_amt: parseInt(editForm.discount_amt) || 0,
        max_uses: parseInt(editForm.max_uses) || 0,
        valid_from: editForm.valid_from || undefined,
        valid_to: editForm.valid_to || undefined,
        enabled: editForm.enabled,
      }}));
      setEditTarget(null); loadCodes();
    } catch (e: unknown) { setEditError(getErrorMessage(e, t('updateFailed'))); }
    finally { setEditing(false); }
  }

  const [deleteTarget, setDeleteTarget] = useState<model_PromoCode | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await sessionApi(AdminService.adminDeletePromoCode({ id: deleteTarget.id! }));
      setDeleteTarget(null); loadCodes();
    } catch (e: unknown) { alert(getErrorMessage(e, t('deleteFailed'))); }
    finally { setDeleting(false); }
  }

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="relative h-12 w-12">
          <svg className="animate-spin h-12 w-12 text-md-primary" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
              strokeDasharray="100" strokeDashoffset="60" className="opacity-80" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 animate-slide-up">
        <div>
          <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">{t('title')}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={loadCodes}
            disabled={loading}
            className="state-layer inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium
              bg-md-surface-container-high text-foreground border border-border
              disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {tCommon('refresh')}
          </button>
          {canWrite && (
            <button
              onClick={() => { setCreateForm(emptyForm); setCreateError(''); setCreateOpen(true); }}
              className="state-layer ripple inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium
                bg-md-primary text-md-on-primary elevation-1
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" />
              {t('create')}
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-xl px-4 py-3 bg-md-error-container text-md-on-error-container text-sm animate-slide-up">
          {error}
        </div>
      )}

      {/* ── Table card ── */}
      <div className="bg-card border rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: '60ms' }}>
        <Table>
          <TableHeader>
            <TableRow className="bg-md-surface-container-high border-b border-border hover:bg-md-surface-container-high">
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colCode')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colDiscountPct')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colDiscountAmt')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colMaxUses')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colUsedCount')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colValidFrom')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colValidTo')}</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colStatus')}</TableHead>
              {canWrite && <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 9 : 8} className="py-16">
                  <div className="flex flex-col items-center gap-3">
                    <svg className="animate-spin h-8 w-8 text-md-primary" viewBox="0 0 48 48" fill="none">
                      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                        strokeDasharray="100" strokeDashoffset="60" className="opacity-80" />
                    </svg>
                    <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 9 : 8} className="py-20">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="rounded-full p-4 bg-md-surface-container-high">
                      <Plus className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">{t('noCodes')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : codes.map((pc, i) => (
              <TableRow
                key={pc.id}
                className="hover-state border-b border-border/60 last:border-0 animate-slide-up"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1
                    bg-md-primary-container text-md-on-primary-container
                    font-mono text-sm font-medium tracking-wide">
                    {pc.code}
                  </span>
                </TableCell>
                <TableCell className="font-display text-sm font-600 text-foreground">
                  {(pc.discount_pct ?? 0) > 0 ? `${pc.discount_pct}%` : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="font-display text-sm font-600 text-foreground">
                  {(pc.discount_amt ?? 0) > 0 ? `¥${((pc.discount_amt ?? 0) / 100).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm text-foreground">
                  {(pc.max_uses ?? 0) === 0
                    ? <span className="text-xs text-md-tertiary font-medium">{t('unlimited')}</span>
                    : pc.max_uses}
                </TableCell>
                <TableCell className="font-display text-sm font-600 text-foreground">{pc.used_count ?? 0}</TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">{formatDate(pc.valid_from ?? '')}</TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">{formatDate(pc.valid_to ?? '')}</TableCell>
                <TableCell>
                  {(pc.enabled ?? false) ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                      bg-md-tertiary-container text-md-on-tertiary-container">
                      <span className="size-1.5 rounded-full bg-md-tertiary" />
                      {t('enabled')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                      bg-muted text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-md-outline" />
                      {t('disabled')}
                    </span>
                  )}
                </TableCell>
                {canWrite && (
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(pc)}
                        className="state-layer inline-flex items-center justify-center rounded-lg h-8 w-8
                          text-muted-foreground hover:text-foreground
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(pc)}
                        className="state-layer inline-flex items-center justify-center rounded-lg h-8 w-8
                          text-muted-foreground hover:text-destructive
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl elevation-3 bg-md-surface-container-low border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">{t('create')}</DialogTitle>
          </DialogHeader>
          <PromoForm form={createForm} setForm={setCreateForm} t={t as (k: string) => string} />
          {createError && (
            <p className="text-sm text-md-on-error-container bg-md-error-container rounded-lg px-3 py-2">{createError}</p>
          )}
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setCreateOpen(false)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium
                bg-md-surface-container-high text-foreground border border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !createForm.code}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium
                bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {creating ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="rounded-2xl elevation-3 bg-md-surface-container-low border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">{t('edit')}</DialogTitle>
          </DialogHeader>
          <PromoForm form={editForm} setForm={setEditForm} t={t as (k: string) => string} />
          {editError && (
            <p className="text-sm text-md-on-error-container bg-md-error-container rounded-lg px-3 py-2">{editError}</p>
          )}
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setEditTarget(null)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium
                bg-md-surface-container-high text-foreground border border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleEdit}
              disabled={editing || !editForm.code}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium
                bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {editing ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="rounded-2xl elevation-3 bg-md-surface-container-low border-0 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">{tCommon('delete')}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground leading-relaxed">
            {t('deleteConfirm', { code: deleteTarget?.code ?? '' })}
          </p>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium
                bg-md-surface-container-high text-foreground border border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium
                bg-md-error text-md-on-error elevation-1
                disabled:opacity-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
            >
              {tCommon('delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
