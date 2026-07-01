import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useFormat } from '@/lib/format';
import type { model_Announcement } from '@/src/generated/client/models/model_Announcement';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshCw, Plus, Pencil, Trash2, Megaphone, AlertTriangle, Info, AlertCircle, Pin, Globe, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

const CONTENT_MAX = 2000;

// M3-compliant level styling using §10 status token recipes
const LEVEL_CONFIG: Record<string, {
  containerClass: string;
  icon: React.ElementType;
  dotClass: string;
}> = {
  info: {
    containerClass: 'bg-md-primary-container text-md-on-primary-container',
    icon: Info,
    dotClass: 'bg-md-primary',
  },
  warning: {
    containerClass: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
    icon: AlertTriangle,
    dotClass: 'bg-[hsl(43_96%_50%)]',
  },
  critical: {
    containerClass: 'bg-md-error-container text-md-on-error-container',
    icon: AlertCircle,
    dotClass: 'bg-md-error',
  },
};

export default function AnnouncementsPage() {
  const t = useTranslations('announcements');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const fmt = useFormat();
  const { user, loading: authLoading } = useCurrentUser();

  const [items, setItems] = useState<model_Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // URL-synced pagination state — hydrated from query once router.isReady
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [initialized, setInitialized] = useState(false);
  const syncUrl = useRef(false);

  // ── Restore page / limit from URL once router.query is populated ──
  useEffect(() => {
    if (!router.isReady || initialized) return;
    const q = router.query;
    if (typeof q.page === 'string') {
      const p = parseInt(q.page, 10);
      if (Number.isFinite(p) && p > 0) setPage(p);
    }
    if (typeof q.limit === 'string') {
      const l = parseInt(q.limit, 10);
      if ([20, 50, 100].includes(l)) setLimit(l);
    }
    setInitialized(true);
  }, [router.isReady, router.query, initialized]);

  // ── Sync page / limit changes to URL so the browser Back button restores state ──
  useEffect(() => {
    if (!initialized) return;
    if (!syncUrl.current) {
      syncUrl.current = true;
      return;
    }
    const query: Record<string, string | number> = {};
    if (page !== 1) query.page = page;
    if (limit !== 20) query.limit = limit;
    router.replace({ query }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, page, limit]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListAnnouncements({
        page: page,
        limit: limit,
      }));
      setItems(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [page, limit, t]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.can('announcement:write')) { router.replace('/dashboard'); return; }
    if (!initialized) return;
    loadData();
  }, [authLoading, user, loadData, router, initialized]);

  // ── Create / edit dialog state ────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<model_Announcement | null>(null);
  const [form, setForm] = useState({ title: '', content: '', level: 'info', pinned: false, published: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

  // Stable ids for label/control association (WCAG 1.3.1 / 4.1.2).
  const baseId = useId();
  const titleInputId = `${baseId}-title`;
  const levelLabelId = `${baseId}-level-label`;
  const contentInputId = `${baseId}-content`;
  const pinnedLabelId = `${baseId}-pinned-label`;
  const publishedLabelId = `${baseId}-published-label`;

  // Autofocus the title field when the dialog opens. Input doesn't forward a
  // ref, so focus by id once the field is mounted.
  useEffect(() => {
    if (dialogOpen) {
      const id = window.setTimeout(() => {
        document.getElementById(titleInputId)?.focus();
      }, 60);
      return () => window.clearTimeout(id);
    }
  }, [dialogOpen, titleInputId]);

  const titleEmpty = !form.title.trim();
  const titleInvalid = titleTouched && titleEmpty;

  function openCreate() {
    setEditing(null);
    setForm({ title: '', content: '', level: 'info', pinned: false, published: false });
    setSaveError('');
    setTitleTouched(false);
    setDialogOpen(true);
  }

  function openEdit(ann: model_Announcement) {
    setEditing(ann);
    setForm({ title: ann.title ?? '', content: ann.content ?? '', level: ann.level ?? 'info', pinned: ann.pinned ?? false, published: ann.published ?? false });
    setSaveError('');
    setTitleTouched(false);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    if (saving) return; // guarded by pending, but be defensive
    if (!open) setSaveError('');
    setDialogOpen(open);
  }

  async function handleSave() {
    if (titleEmpty) {
      setTitleTouched(true);
      document.getElementById(titleInputId)?.focus();
      return;
    }
    setSaving(true);
    setSaveError('');
    const isEdit = !!editing;
    try {
      const payload = { ...form, title: form.title.trim() };
      if (editing) {
        await sessionApi(AdminService.adminUpdateAnnouncement({ id: editing.id!, requestBody: payload }));
      } else {
        await sessionApi(AdminService.adminCreateAnnouncement({ requestBody: payload }));
      }
      setDialogOpen(false);
      toast.success(isEdit ? t('updateSuccess') : t('createSuccess'));
      loadData();
    } catch (e: unknown) {
      setSaveError(getErrorMessage(e, t('saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  // ── Delete confirmation state ─────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<model_Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Element to restore focus to after the AlertDialog closes.
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  function requestDelete(ann: model_Announcement, trigger: HTMLButtonElement | null) {
    deleteTriggerRef.current = trigger;
    setDeleteTarget(ann);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await sessionApi(AdminService.adminDeleteAnnouncement({ id: deleteTarget.id! }));
      setDeleteTarget(null);
      toast.success(t('deleteSuccess'));
      loadData();
    } catch (e: unknown) {
      setDeleteTarget(null);
      toast.error(getErrorMessage(e, t('deleteFailed')));
    } finally {
      setDeleting(false);
    }
  }

  function handleDeleteOpenChange(open: boolean) {
    if (deleting) return;
    if (!open) {
      setDeleteTarget(null);
      // Return focus to the row's delete button.
      deleteTriggerRef.current?.focus();
    }
  }

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="flex flex-col items-center gap-4 animate-fade-in" role="status" aria-live="polite">
        {/* M3 circular progress indicator */}
        <div className="relative size-12" aria-hidden="true">
          <svg className="size-12 animate-spin motion-reduce:animate-none" viewBox="0 0 48 48" fill="none" style={{ animationDuration: '1.2s' }}>
            <circle
              cx="24" cy="24" r="20"
              stroke="hsl(var(--md-surface-container-highest))"
              strokeWidth="4"
            />
            <circle
              cx="24" cy="24" r="20"
              stroke="hsl(var(--md-primary))"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="94"
              strokeDashoffset="62"
            />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </div>
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        icon={<Megaphone />}
        title={t('title')}
        description={total > 0 ? t('recordCount', { count: total }) : undefined}
        actions={
          <>
            <Button variant="outline" size="sm" type="button" onClick={loadData} loading={loading}>
              {!loading && <RefreshCw className="size-4" aria-hidden="true" />}
              <span>{tCommon('refresh')}</span>
            </Button>
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              <span>{t('create')}</span>
            </Button>
          </>
        }
      />

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl px-4 py-3 bg-md-error-container text-md-on-error-container text-sm animate-slide-up"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-md-on-error-container hover:text-md-on-error-container"
            onClick={() => setError('')}
            aria-label={tCommon('dismiss')}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* Table card */}
      <div className="bg-card border rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: '40ms' }}>
        <Table aria-label={t('title')}>
          <TableHeader>
            <TableRow className="border-b border-border bg-md-surface-container-high/50">
              <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colTitle')}</TableHead>
              <TableHead className="w-28 text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colLevel')}</TableHead>
              <TableHead className="w-24 text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colPinned')}</TableHead>
              <TableHead className="w-24 text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colPublished')}</TableHead>
              <TableHead className="w-40 text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colCreatedAt')}</TableHead>
              <TableHead className="w-24 text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16">
                  <div className="flex flex-col items-center justify-center gap-4" role="status" aria-live="polite">
                    {/* M3 circular progress */}
                    <div className="relative size-10" aria-hidden="true">
                      <svg className="size-10 animate-spin motion-reduce:animate-none" viewBox="0 0 48 48" fill="none" style={{ animationDuration: '1.2s' }}>
                        <circle cx="24" cy="24" r="20" stroke="hsl(var(--md-surface-container-highest))" strokeWidth="4" />
                        <circle cx="24" cy="24" r="20" stroke="hsl(var(--md-primary))" strokeWidth="4" strokeLinecap="round" strokeDasharray="94" strokeDashoffset="62" />
                      </svg>
                    </div>
                    <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-20">
                  <div className="flex flex-col items-center justify-center gap-3 text-center" role="status">
                    <div className="flex items-center justify-center size-14 rounded-full bg-md-surface-container-highest" aria-hidden="true">
                      <Megaphone className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-500 text-muted-foreground">{t('noData')}</p>
                    <Button type="button" onClick={openCreate} className="mt-1">
                      <Plus className="size-4" aria-hidden="true" />
                      <span>{t('create')}</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((ann, i) => {
                const levelCfg = LEVEL_CONFIG[ann.level ?? ''] ?? LEVEL_CONFIG.info;
                const LevelIcon = levelCfg.icon;
                return (
                  <TableRow
                    key={ann.id}
                    className="hover-state border-b border-border/60 last:border-0"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <TableCell className="font-500 text-foreground py-3">
                      <div>
                        <span className="block">{ann.title}</span>
                        {ann.content && (
                          <span className="block line-clamp-1 text-xs text-muted-foreground max-w-xs mt-0.5">
                            {ann.content}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${levelCfg.containerClass}`}>
                        <LevelIcon className="size-3" aria-hidden="true" />
                        {t(`level${(ann.level ?? '').charAt(0).toUpperCase() + (ann.level ?? '').slice(1)}`)}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      {ann.pinned ? (
                        <span className="inline-flex items-center gap-1 text-xs text-md-primary font-500" role="img" aria-label={t('pinned')}>
                          <Pin className="size-3" aria-hidden="true" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs" aria-hidden="true">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {ann.published ? (
                        <span className="inline-flex items-center gap-1 text-xs text-md-tertiary font-500" role="img" aria-label={t('published')}>
                          <Globe className="size-3" aria-hidden="true" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs" aria-hidden="true">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-3 tabular-nums">
                      {ann.created_at
                        ? <time dateTime={ann.created_at} title={fmt.dateTime(ann.created_at)}>{fmt.relative(ann.created_at)}</time>
                        : null}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          onClick={() => openEdit(ann)}
                          aria-label={`${t('editTitle')}: ${ann.title}`}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          className="text-md-on-surface-variant hover:text-md-error"
                          onClick={(e) => requestDelete(ann, e.currentTarget)}
                          aria-label={`${tCommon('delete')}: ${ann.title}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Pagination ── */}
      {Math.ceil(total / limit) > 1 && (
        <div className="flex items-center justify-between gap-3 animate-slide-up" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{tCommon('perPage')}</span>
            <Select
              value={String(limit)}
              onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="w-20 h-8 text-sm" aria-label={tCommon('perPage')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label={t('prevPage')}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              {t('prevPage')}
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {page} / {Math.max(1, Math.ceil(total / limit))}
            </span>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={page >= Math.ceil(total / limit)}
              onClick={() => setPage(page + 1)}
              aria-label={t('nextPage')}
            >
              {t('nextPage')}
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          size="lg"
          pending={saving}
          stickyHeaderFooter
          closeLabel={tCommon('cancel')}
          description={editing ? t('editDescription') : t('createDescription')}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
            className="contents"
          >
            <DialogHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center size-10 rounded-xl bg-md-primary-container text-md-on-primary-container" aria-hidden="true">
                  <Megaphone className="size-4" />
                </div>
                <DialogTitle className="font-display text-lg font-600">
                  {editing ? t('editTitle') : t('create')}
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor={titleInputId} className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {t('colTitle')} <span className="text-md-error" aria-hidden="true">*</span>
                </Label>
                <Input
                  id={titleInputId}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  onBlur={() => setTitleTouched(true)}
                  placeholder={t('titlePlaceholder')}
                  required
                  aria-required="true"
                  error={titleInvalid ? t('titleRequired') : undefined}
                  className="bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
                />
              </div>

              <div className="space-y-1.5">
                <Label id={levelLabelId} className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colLevel')}</Label>
                <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                  <SelectTrigger aria-labelledby={levelLabelId} className="rounded-lg bg-md-surface-container-high/50 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-md-primary" aria-hidden="true" />
                        {t('levelInfo')}
                      </span>
                    </SelectItem>
                    <SelectItem value="warning">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-[hsl(43_96%_50%)]" aria-hidden="true" />
                        {t('levelWarning')}
                      </span>
                    </SelectItem>
                    <SelectItem value="critical">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-md-error" aria-hidden="true" />
                        {t('levelCritical')}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={contentInputId} className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colContent')}</Label>
                <Textarea
                  id={contentInputId}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder={t('contentPlaceholder')}
                  minRows={6}
                  maxLength={CONTENT_MAX}
                  showCount
                  helperText={t('contentHelper')}
                  className="bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
                />
              </div>

              <div className="flex items-center gap-6 pt-1">
                <div className="flex items-center gap-2.5">
                  <Switch
                    checked={form.pinned}
                    onCheckedChange={(v) => setForm({ ...form, pinned: v })}
                    onLabel={t('pinned')}
                    offLabel={t('pinned')}
                    aria-labelledby={pinnedLabelId}
                  />
                  <span
                    id={pinnedLabelId}
                    className="text-sm font-500 flex items-center gap-1.5 cursor-pointer select-none"
                    onClick={() => setForm((f) => ({ ...f, pinned: !f.pinned }))}
                  >
                    <Pin className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {t('pinned')}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch
                    checked={form.published}
                    onCheckedChange={(v) => setForm({ ...form, published: v })}
                    onLabel={t('published')}
                    offLabel={t('published')}
                    aria-labelledby={publishedLabelId}
                  />
                  <span
                    id={publishedLabelId}
                    className="text-sm font-500 flex items-center gap-1.5 cursor-pointer select-none"
                    onClick={() => setForm((f) => ({ ...f, published: !f.published }))}
                  >
                    <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {t('published')}
                  </span>
                </div>
              </div>

              {saveError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 bg-md-error-container text-md-on-error-container text-sm"
                >
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 pt-2">
              <DialogClose asChild>
                <Button variant="outline" type="button" disabled={saving}>
                  {tCommon('cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" loading={saving} disabled={titleEmpty}>
                {saving ? tCommon('saving') : tCommon('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={handleDeleteOpenChange}>
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { title: deleteTarget?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={deleting}
              loadingLabel={tCommon('deleting')}
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
