import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_PromoCode } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { useClipboard } from '@/lib/use-clipboard';
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
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshCw, Plus, Pencil, Trash2, MoreVertical, Tag, Copy, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';


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
  // discount_amt in form is in yuan (元); backend stores fen (分)
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
          {/* Label clarifies unit is yuan (元); backend stores fen */}
          <Label htmlFor="pc-amt" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('discountAmtYuan')}</Label>
          <Input id="pc-amt" type="number" min="0" step="0.01" value={form.discount_amt}
            aria-invalid={errors.discount_amt ? true : undefined}
            aria-describedby={errors.discount_amt ? 'pc-amt-err' : undefined}
            onChange={(e) => setForm({ ...form, discount_amt: e.target.value })} onBlur={onBlurField} placeholder={t('discountAmtPlaceholder')}
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

/** Inline copy button for a promo code badge. */
function CodeCopyButton({ code, t }: { code: string; t: (k: string, params?: Record<string, string>) => string }) {
  const { copied, copy } = useClipboard();
  const toast = useToast();

  async function handleCopy() {
    const ok = await copy(code);
    if (ok) {
      toast.success(t('copied'));
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-5 w-5 shrink-0"
      aria-label={t('copyCode', { code })}
      onClick={handleCopy}
    >
      {copied
        ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-md-tertiary" />
        : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
    </Button>
  );
}

export default function PromoCodesPage() {
  const t = useTranslations('promoCodes');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const fmt = useFormat();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('order:write') ?? false;

  const [codes, setCodes] = useState<model_PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Client-side filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const filteredCodes = codes.filter((c) => {
    const matchSearch = search === '' || (c.code ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'enabled' && (c.enabled ?? false)) ||
      (statusFilter === 'disabled' && !(c.enabled ?? false));
    return matchSearch && matchStatus;
  });

  const loadCodes = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await sessionApi(AdminService.adminListPromoCodes());
      setCodes(Array.isArray(data) ? data : []);
    } catch (e: unknown) { setError(getErrorMessage(e, t('loadFailed'))); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { if (!authLoading && user?.can('order:write')) loadCodes(); }, [authLoading, user, loadCodes]);
  useEffect(() => { if (!authLoading && (!user || !user.can('order:write'))) router.replace('/dashboard'); }, [authLoading, user, router]);

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
        // Form is in yuan (元); backend stores fen (分) — multiply by 100
        discount_amt: Math.round(parseFloat(createForm.discount_amt) * 100) || 0,
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
    setEditForm({
      code: pc.code ?? '',
      discount_pct: String(pc.discount_pct ?? 0),
      // Backend stores fen (分); display in yuan (元) ÷ 100
      discount_amt: String((pc.discount_amt ?? 0) / 100),
      max_uses: String(pc.max_uses ?? 0),
      valid_from: pc.valid_from?.slice(0, 16) ?? '',
      valid_to: pc.valid_to?.slice(0, 16) ?? '',
      enabled: pc.enabled ?? false,
    });
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
        // Form is in yuan (元); backend stores fen (分) — multiply by 100
        discount_amt: Math.round(parseFloat(editForm.discount_amt) * 100) || 0,
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

  const colSpan = canWrite ? 8 : 7;

  return (
    <PageContainer>
      {/* ── Page header ── */}
      <PageHeader
        icon={<Tag aria-hidden="true" />}
        title={t('title')}
        description={t('pageDescription', { count: String(filteredCodes.length) })}
        accent="secondary"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={loadCodes}
              loading={loading}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {tCommon('refresh')}
            </Button>
            {canWrite && (
              <Button
                type="button"
                onClick={() => { setCreateForm(emptyForm); setCreateError(''); setCreateShowErrors(false); setCreateOpen(true); }}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                {t('create')}
              </Button>
            )}
          </>
        }
      />

      {/* ── Error banner ── */}
      {error && (
        <div role="alert" aria-live="polite" className="rounded-xl px-4 py-3 bg-md-error-container text-md-on-error-container text-sm animate-slide-up">
          {error}
        </div>
      )}

      {/* ── Search / filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('searchCode')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs rounded-lg bg-md-surface-container-high border-0 focus-visible:ring-2 focus-visible:ring-md-primary"
          aria-label={t('searchCode')}
        />
        <div className="flex items-center gap-1.5" role="group" aria-label={t('filterByStatus')}>
          {(['all', 'enabled', 'disabled'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={statusFilter === v}
              onClick={() => setStatusFilter(v)}
              className={[
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                statusFilter === v
                  ? 'bg-md-secondary-container text-md-on-secondary-container'
                  : 'bg-md-surface-container text-muted-foreground hover:bg-md-surface-container-high',
              ].join(' ')}
            >
              {t(`filter_${v}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table card ── */}
      {/* outer div: overflow-x-auto for narrow screens; inner div: rounded-xl overflow-hidden for corner clipping */}
      <div className="overflow-x-auto rounded-xl animate-slide-up" style={{ animationDelay: '60ms' }}>
        <div className="bg-card border rounded-xl overflow-hidden min-w-[700px]">
          <Table>
            <TableHeader>
              <TableRow className="bg-md-surface-container-high border-b border-border hover:bg-md-surface-container-high">
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colCode')}</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colDiscountPct')}</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colDiscountAmt')}</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colUsage')}</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">{t('colValidFrom')}</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">{t('colValidTo')}</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colStatus')}</TableHead>
                {canWrite && <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('colActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-16">
                    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
                      <svg aria-hidden="true" className="motion-reduce:animate-none animate-spin h-8 w-8 text-md-primary" viewBox="0 0 48 48" fill="none">
                        <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
                          strokeDasharray="100" strokeDashoffset="60" className="opacity-80" />
                      </svg>
                      <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredCodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-20">
                    <div role="status" aria-label={t('noCodes')} className="flex flex-col items-center gap-3 text-center">
                      <div className="rounded-full p-4 bg-md-surface-container-high">
                        <Plus aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">{t('noCodes')}</p>
                      {canWrite && search === '' && statusFilter === 'all' && (
                        <Button
                          type="button"
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
              ) : filteredCodes.map((pc, i) => {
                const maxUses = pc.max_uses ?? 0;
                const usedCount = pc.used_count ?? 0;
                const isExhausted = maxUses > 0 && usedCount >= maxUses;
                const isNearLimit = maxUses > 0 && !isExhausted && usedCount >= maxUses * 0.8;

                return (
                  <TableRow
                    key={pc.id}
                    className="hover-state border-b border-border/60 last:border-0 animate-slide-up"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    {/* Code with copy button */}
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-lg px-2.5 py-1
                          bg-md-primary-container text-md-on-primary-container
                          font-mono text-sm font-medium tracking-wide">
                          {pc.code}
                        </span>
                        <CodeCopyButton code={pc.code ?? ''} t={t as (k: string, params?: Record<string, string>) => string} />
                      </span>
                    </TableCell>
                    {/* Discount % */}
                    <TableCell className="font-display text-sm font-600 text-foreground">
                      {(pc.discount_pct ?? 0) > 0 ? `${pc.discount_pct}%` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    {/* Discount amount (display in yuan, stored in fen) */}
                    <TableCell className="font-display text-sm font-600 text-foreground">
                      {(pc.discount_amt ?? 0) > 0 ? `¥${((pc.discount_amt ?? 0) / 100).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    {/* Combined usage: used / max with visual warnings */}
                    <TableCell className="text-sm tabular-nums">
                      <span className={isExhausted ? 'text-muted-foreground' : isNearLimit ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-foreground'}>
                        {usedCount}
                        {' / '}
                        {maxUses === 0
                          ? <span className="text-xs text-md-tertiary font-medium">∞</span>
                          : maxUses}
                      </span>
                      {isExhausted && (
                        <span className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                          {t('exhausted')}
                        </span>
                      )}
                    </TableCell>
                    {/* Valid from */}
                    <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {pc.valid_from ? (
                        <span title={fmt.dateTime(pc.valid_from)}>{fmt.date(pc.valid_from)}</span>
                      ) : (
                        <span aria-label={t('noDate')}><span aria-hidden="true">—</span></span>
                      )}
                    </TableCell>
                    {/* Valid to */}
                    <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {pc.valid_to ? (
                        <span title={fmt.dateTime(pc.valid_to)}>{fmt.date(pc.valid_to)}</span>
                      ) : (
                        <span aria-label={t('noDate')}><span aria-hidden="true">—</span></span>
                      )}
                    </TableCell>
                    {/* Status */}
                    <TableCell>
                      {(pc.enabled ?? false) ? (
                        isExhausted ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-md-outline" />
                            {t('enabledExhausted')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                            bg-md-tertiary-container text-md-on-tertiary-container">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-md-tertiary" />
                            {t('enabled')}
                          </span>
                        )
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
                            <Button type="button" variant="ghost" size="icon" aria-label={t('rowActions', { code: pc.code ?? '' })}>
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
                );
              })}
            </TableBody>
          </Table>
        </div>
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
    </PageContainer>
  );
}
