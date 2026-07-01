import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_PromoCode } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { RefreshCw, Plus, Pencil, Trash2, MoreVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';


function formatDate(s: string) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

const emptyForm = { code: '', discount_pct: '', discount_amt: '', max_uses: '', valid_from: '', valid_to: '', enabled: true };

type FormState = typeof emptyForm;
type FieldErrors = Partial<Record<keyof FormState | 'discount', string>>;

/** Shared, accessible inline error surface (role=alert + aria-live). */
function FormError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="text-sm text-md-on-error-container bg-md-error-container rounded-lg px-3 py-2"
    >
      {children}
    </p>
  );
}

/** Validates the form, returning per-field error messages keyed for display. */
function validateForm(form: FormState, t: (k: string) => string): FieldErrors {
  const errs: FieldErrors = {};
  if (!form.code.trim()) errs.code = t('errCodeRequired');
  const pct = form.discount_pct === '' ? null : Number(form.discount_pct);
  const amt = form.discount_amt === '' ? null : Number(form.discount_amt);
  if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) errs.discount_pct = t('errPctRange');
  if (amt !== null && (isNaN(amt) || amt < 0)) errs.discount_amt = t('errAmtRange');
  if ((pct ?? 0) <= 0 && (amt ?? 0) <= 0) errs.discount = t('errDiscountRequired');
  const max = form.max_uses === '' ? null : Number(form.max_uses);
  if (max !== null && (isNaN(max) || max < 0)) errs.max_uses = t('errMaxUsesRange');
  if (form.valid_from && form.valid_to && new Date(form.valid_to) < new Date(form.valid_from)) {
    errs.valid_to = t('errValidRange');
  }
  return errs;
}

function PromoForm({
  form, setForm, t, errors, onBlurField,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  t: (k: string) => string;
  errors: FieldErrors;
  onBlurField: () => void;
}) {
  const inputCls = 'rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary';
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label htmlFor="pc-code" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('code')}</Label>
        <Input
          id="pc-code"
          autoFocus
          value={form.code}
          maxLength={32}
          required
          aria-required="true"
          aria-invalid={errors.code ? true : undefined}
          aria-describedby={errors.code ? 'pc-code-err' : 'pc-code-help'}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          onBlur={onBlurField}
          className={`${inputCls} font-mono`}
        />
        {errors.code
          ? <p id="pc-code-err" role="alert" className="text-xs text-md-error">{errors.code}</p>
          : <p id="pc-code-help" className="text-xs text-muted-foreground">{t('codeHelp')}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pc-pct" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('discountPct')}</Label>
          <Input id="pc-pct" type="number" min="0" max="100" step="1" value={form.discount_pct}
            aria-invalid={errors.discount_pct ? true : undefined}
            aria-describedby={errors.discount_pct ? 'pc-pct-err' : undefined}
            onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} onBlur={onBlurField} placeholder="0-100"
            className={inputCls} />
          {errors.discount_pct && <p id="pc-pct-err" role="alert" className="text-xs text-md-error">{errors.discount_pct}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-amt" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('discountAmt')}</Label>
          <Input id="pc-amt" type="number" min="0" step="1" value={form.discount_amt}
            aria-invalid={errors.discount_amt ? true : undefined}
            aria-describedby={errors.discount_amt ? 'pc-amt-err' : undefined}
            onChange={(e) => setForm({ ...form, discount_amt: e.target.value })} onBlur={onBlurField} placeholder="¥0 = 无"
            className={inputCls} />
          {errors.discount_amt && <p id="pc-amt-err" role="alert" className="text-xs text-md-error">{errors.discount_amt}</p>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">{t('discountHelp')}</p>
      {errors.discount && <p role="alert" className="text-xs text-md-error -mt-2">{errors.discount}</p>}
      <div className="space-y-1.5">
        <Label htmlFor="pc-max" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('maxUses')}</Label>
        <Input id="pc-max" type="number" min="0" step="1" value={form.max_uses}
          aria-invalid={errors.max_uses ? true : undefined}
          aria-describedby={errors.max_uses ? 'pc-max-err' : undefined}
          onChange={(e) => setForm({ ...form, max_uses: e.target.value })} onBlur={onBlurField} placeholder="0 = unlimited"
          className={inputCls} />
        {errors.max_uses && <p id="pc-max-err" role="alert" className="text-xs text-md-error">{errors.max_uses}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pc-from" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('validFrom')}</Label>
          <Input id="pc-from" type="datetime-local" value={form.valid_from}
            onChange={(e) => setForm({ ...form, valid_from: e.target.value })} onBlur={onBlurField}
            className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-to" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('validTo')}</Label>
          <Input id="pc-to" type="datetime-local" value={form.valid_to}
            aria-invalid={errors.valid_to ? true : undefined}
            aria-describedby={errors.valid_to ? 'pc-to-err' : undefined}
            onChange={(e) => setForm({ ...form, valid_to: e.target.value })} onBlur={onBlurField}
            className={inputCls} />
          {errors.valid_to && <p id="pc-to-err" role="alert" className="text-xs text-md-error">{errors.valid_to}</p>}
        </div>
      </div>
      <label htmlFor="pc-enabled" className="flex items-center gap-3 rounded-xl px-4 py-3 bg-md-surface-container cursor-pointer hover:bg-md-surface-container-high transition-colors">
        <Switch
          id="pc-enabled"
          checked={form.enabled}
          onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          onLabel={t('enabled')}
          offLabel={t('disabled')}
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
  const toast = useToast();
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
  const [createShowErrors, setCreateShowErrors] = useState(false);
  const createErrors = validateForm(createForm, t);
  const createValid = Object.keys(createErrors).length === 0;

  async function handleCreate(e?: React.FormEvent) {
    e?.preventDefault();
    setCreateShowErrors(true);
    if (!createValid) return;
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
      setCreateOpen(false);
      toast.success(t('createSuccess'));
      loadCodes();
    } catch (e: unknown) { setCreateError(getErrorMessage(e, t('createFailed'))); }
    finally { setCreating(false); }
  }

  const [editTarget, setEditTarget] = useState<model_PromoCode | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');
  const [editShowErrors, setEditShowErrors] = useState(false);
  const editErrors = validateForm(editForm, t);
  const editValid = Object.keys(editErrors).length === 0;

  function openEdit(pc: model_PromoCode) {
    setEditTarget(pc);
    setEditForm({ code: pc.code ?? '', discount_pct: String(pc.discount_pct ?? 0), discount_amt: String(pc.discount_amt ?? 0),
      max_uses: String(pc.max_uses ?? 0), valid_from: pc.valid_from?.slice(0,16) ?? '', valid_to: pc.valid_to?.slice(0,16) ?? '', enabled: pc.enabled ?? false });
    setEditError('');
    setEditShowErrors(false);
  }

  async function handleEdit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!editTarget) return;
    setEditShowErrors(true);
    if (!editValid) return;
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
      setEditTarget(null);
      toast.success(t('updateSuccess'));
      loadCodes();
    } catch (e: unknown) { setEditError(getErrorMessage(e, t('updateFailed'))); }
    finally { setEditing(false); }
  }

  const [deleteTarget, setDeleteTarget] = useState<model_PromoCode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError('');
    try {
      await sessionApi(AdminService.adminDeletePromoCode({ id: deleteTarget.id! }));
      setDeleteTarget(null);
      toast.success(t('deleteSuccess'));
      loadCodes();
    } catch (e: unknown) { setDeleteError(getErrorMessage(e, t('deleteFailed'))); }
    finally { setDeleting(false); }
  }

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="relative h-12 w-12">
          <svg aria-hidden="true" className="motion-reduce:animate-none animate-spin h-12 w-12 text-md-primary" viewBox="0 0 48 48" fill="none">
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
          <Button
            variant="outline"
            onClick={loadCodes}
            loading={loading}
          >
            {!loading && <RefreshCw aria-hidden="true" className="h-4 w-4" />}
            {tCommon('refresh')}
          </Button>
          {canWrite && (
            <Button
              onClick={() => { setCreateForm(emptyForm); setCreateError(''); setCreateShowErrors(false); setCreateOpen(true); }}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t('create')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div role="alert" aria-live="polite" className="rounded-xl px-4 py-3 bg-md-error-container text-md-on-error-container text-sm animate-slide-up">
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
                  <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
                    <svg aria-hidden="true" className="motion-reduce:animate-none animate-spin h-8 w-8 text-md-primary" viewBox="0 0 48 48" fill="none">
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
                  <div role="status" aria-label={t('noCodes')} className="flex flex-col items-center gap-3 text-center">
                    <div className="rounded-full p-4 bg-md-surface-container-high">
                      <Plus aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">{t('noCodes')}</p>
                    {canWrite && (
                      <Button
                        className="mt-1"
                        onClick={() => { setCreateForm(emptyForm); setCreateError(''); setCreateShowErrors(false); setCreateOpen(true); }}
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        {t('create')}
                      </Button>
                    )}
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
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {pc.valid_from
                    ? formatDate(pc.valid_from)
                    : <span aria-label={t('noDate')}><span aria-hidden="true">—</span></span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {pc.valid_to
                    ? formatDate(pc.valid_to)
                    : <span aria-label={t('noDate')}><span aria-hidden="true">—</span></span>}
                </TableCell>
                <TableCell>
                  {(pc.enabled ?? false) ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                      bg-md-tertiary-container text-md-on-tertiary-container">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-md-tertiary" />
                      {t('enabled')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                      bg-muted text-muted-foreground">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-md-outline" />
                      {t('disabled')}
                    </span>
                  )}
                </TableCell>
                {canWrite && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t('rowActions', { code: pc.code ?? '' })}>
                          <MoreVertical aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem size="comfortable" onSelect={() => openEdit(pc)}>
                          <Pencil aria-hidden="true" className="h-4 w-4" />
                          {t('edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem size="comfortable" variant="destructive" onSelect={() => { setDeleteError(''); setDeleteTarget(pc); }}>
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                          {tCommon('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          className="rounded-2xl elevation-3 bg-md-surface-container-low border-0 sm:max-w-md"
          pending={creating}
          closeLabel={tCommon('cancel')}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">{t('create')}</DialogTitle>
            <DialogDescription>{t('createDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <PromoForm form={createForm} setForm={setCreateForm} t={t as (k: string) => string}
              errors={createShowErrors ? createErrors : {}} onBlurField={() => setCreateShowErrors(true)} />
            {createError && <FormError>{createError}</FormError>}
            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="submit"
                loading={creating}
                disabled={createShowErrors && !createValid}
                title={createShowErrors && !createValid ? t('fixErrors') : undefined}
              >
                {tCommon('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open && !editing) setEditTarget(null); }}>
        <DialogContent
          className="rounded-2xl elevation-3 bg-md-surface-container-low border-0 sm:max-w-md"
          pending={editing}
          closeLabel={tCommon('cancel')}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">{t('edit')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit}>
            <PromoForm form={editForm} setForm={setEditForm} t={t as (k: string) => string}
              errors={editShowErrors ? editErrors : {}} onBlurField={() => setEditShowErrors(true)} />
            {editError && <FormError>{editError}</FormError>}
            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)} disabled={editing}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="submit"
                loading={editing}
                disabled={editShowErrors && !editValid}
                title={editShowErrors && !editValid ? t('fixErrors') : undefined}
              >
                {tCommon('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { code: deleteTarget?.code ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm', { code: deleteTarget?.code ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <FormError>{deleteError}</FormError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={deleting}
              loadingLabel={tCommon('saving')}
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
