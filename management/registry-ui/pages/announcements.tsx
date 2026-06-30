import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { model_Announcement } from '@/src/generated/client/models/model_Announcement';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { RefreshCw, Plus, Pencil, Trash2, Megaphone, AlertTriangle, Info, AlertCircle, Pin, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

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
  const { user, loading: authLoading } = useCurrentUser();

  const [items, setItems] = useState<model_Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListAnnouncements({ limit: 100 }));
      setItems(data.items ?? []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && user?.can('announcement:write')) loadData();
  }, [authLoading, user, loadData]);

  useEffect(() => {
    if (!authLoading && user && !user.can('announcement:write')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  // ── Dialog state ──────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<model_Announcement | null>(null);
  const [form, setForm] = useState({ title: '', content: '', level: 'info', pinned: false, published: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  function openCreate() {
    setEditing(null);
    setForm({ title: '', content: '', level: 'info', pinned: false, published: false });
    setSaveError('');
    setDialogOpen(true);
  }

  function openEdit(ann: model_Announcement) {
    setEditing(ann);
    setForm({ title: ann.title ?? '', content: ann.content ?? '', level: ann.level ?? 'info', pinned: ann.pinned ?? false, published: ann.published ?? false });
    setSaveError('');
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      if (editing) {
        await sessionApi(AdminService.adminUpdateAnnouncement({ id: editing.id!, requestBody: form }));
      } else {
        await sessionApi(AdminService.adminCreateAnnouncement({ requestBody: form }));
      }
      setDialogOpen(false);
      loadData();
    } catch (e: unknown) {
      setSaveError(getErrorMessage(e, t('saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      await sessionApi(AdminService.adminDeleteAnnouncement({ id }));
      loadData();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('deleteFailed')));
    }
  }

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        {/* M3 circular progress indicator */}
        <div className="relative size-12">
          <svg className="size-12 animate-spin" viewBox="0 0 48 48" fill="none" style={{ animationDuration: '1.2s' }}>
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
    <div className="p-6 space-y-6">
      {/* Page header — surface container, M3 title area */}
      <div className="animate-slide-up">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-2xl bg-md-primary-container text-md-on-primary-container">
              <Megaphone className="size-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-600 text-foreground">{t('title')}</h1>
              <p className="text-xs text-muted-foreground mt-0.5 font-500 uppercase tracking-wide">
                {items.length > 0 ? `${items.length} ${t('colTitle')}` : ''}
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="state-layer ripple inline-flex items-center gap-2 rounded-lg px-3 py-2
                text-sm font-500 text-foreground bg-md-surface-container-high border border-transparent
                disabled:opacity-50 disabled:pointer-events-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{tCommon('refresh')}</span>
            </button>
            <button
              onClick={openCreate}
              className="state-layer ripple inline-flex items-center gap-2 rounded-lg px-4 py-2
                text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              <Plus className="size-4" />
              <span>{t('create')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-md-error-container text-md-on-error-container text-sm animate-slide-up">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Table card */}
      <div className="bg-card border rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: '40ms' }}>
        <Table>
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
                  <div className="flex flex-col items-center justify-center gap-4">
                    {/* M3 circular progress */}
                    <div className="relative size-10">
                      <svg className="size-10 animate-spin" viewBox="0 0 48 48" fill="none" style={{ animationDuration: '1.2s' }}>
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
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <div className="flex items-center justify-center size-14 rounded-full bg-md-surface-container-highest">
                      <Megaphone className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-500 text-muted-foreground">{t('noData')}</p>
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
                    <TableCell className="font-500 text-foreground py-3">{ann.title}</TableCell>
                    <TableCell className="py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${levelCfg.containerClass}`}>
                        <LevelIcon className="size-3" />
                        {t(`level${(ann.level ?? '').charAt(0).toUpperCase() + (ann.level ?? '').slice(1)}`)}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      {ann.pinned ? (
                        <span className="inline-flex items-center gap-1 text-xs text-md-primary font-500" role="img" aria-label={t('pinned')}>
                          <Pin className="size-3" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {ann.published ? (
                        <span className="inline-flex items-center gap-1 text-xs text-md-tertiary font-500" role="img" aria-label={t('published')}>
                          <Globe className="size-3" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-3 tabular-nums">{formatDate(ann.created_at ?? '')}</TableCell>
                    <TableCell className="py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEdit(ann)}
                          className="state-layer inline-flex items-center justify-center size-8 rounded-lg
                            text-muted-foreground hover:text-foreground
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                          aria-label={t('editTitle')}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(ann.id!)}
                          className="state-layer inline-flex items-center justify-center size-8 rounded-lg
                            text-muted-foreground hover:text-destructive
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1"
                          aria-label={tCommon('delete') ?? 'Delete'}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl bg-card border animate-scale-in">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-9 rounded-xl bg-md-primary-container text-md-on-primary-container">
                <Megaphone className="size-4" />
              </div>
              <DialogTitle className="font-display text-lg font-600">
                {editing ? t('editTitle') : t('create')}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colTitle')}</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t('titlePlaceholder')}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colLevel')}</Label>
              <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                <SelectTrigger className="rounded-lg bg-md-surface-container-high/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl bg-popover border elevation-2">
                  <SelectItem value="info">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-md-primary" />
                      {t('levelInfo')}
                    </span>
                  </SelectItem>
                  <SelectItem value="warning">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-[hsl(43_96%_50%)]" />
                      {t('levelWarning')}
                    </span>
                  </SelectItem>
                  <SelectItem value="critical">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-md-error" />
                      {t('levelCritical')}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">Content</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder={t('contentPlaceholder')}
                rows={6}
                className="rounded-lg bg-md-surface-container-high/50 border-border resize-none focus-visible:ring-md-primary"
              />
            </div>

            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2.5">
                <Switch checked={form.pinned} onCheckedChange={(v) => setForm({ ...form, pinned: v })} />
                <Label className="text-sm font-500 flex items-center gap-1.5">
                  <Pin className="size-3.5 text-muted-foreground" />
                  {t('pinned')}
                </Label>
              </div>
              <div className="flex items-center gap-2.5">
                <Switch checked={form.published} onCheckedChange={(v) => setForm({ ...form, published: v })} />
                <Label className="text-sm font-500 flex items-center gap-1.5">
                  <Globe className="size-3.5 text-muted-foreground" />
                  {t('published')}
                </Label>
              </div>
            </div>

            {saveError && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 bg-md-error-container text-md-on-error-container text-sm">
                <AlertCircle className="size-4 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setDialogOpen(false)}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-4 py-2
                text-sm font-500 text-foreground bg-md-surface-container-high border border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.title}
              className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2
                text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50 disabled:pointer-events-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {saving && (
                <svg className="size-4 animate-spin" viewBox="0 0 48 48" fill="none" style={{ animationDuration: '1s' }}>
                  <circle cx="24" cy="24" r="20" stroke="hsl(var(--md-on-primary)/0.3)" strokeWidth="4" />
                  <circle cx="24" cy="24" r="20" stroke="hsl(var(--md-on-primary))" strokeWidth="4" strokeLinecap="round" strokeDasharray="94" strokeDashoffset="62" />
                </svg>
              )}
              {saving ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
