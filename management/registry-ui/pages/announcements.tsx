import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiPath } from '@/lib/openapi-session';
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
import { RefreshCw, Plus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Announcement {
  id: number;
  title: string;
  content: string;
  level: string;
  pinned: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-yellow-100 text-yellow-800',
  critical: 'bg-red-100 text-red-800',
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiPath(path), { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { error: body.error || res.statusText, status: res.status };
  }
  return res.json();
}

export default function AnnouncementsPage() {
  const t = useTranslations('announcements');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ total: number; items: Announcement[] }>('/admin/announcements?limit=100');
      setItems(data.items ?? []);
    } catch (e: any) {
      setError(e?.error || t('loadFailed'));
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
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ title: '', content: '', level: 'info', pinned: false, published: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  function openCreate() {
    setEditing(null);
    setForm({ title: '', content: '', level: 'info', pinned: false, published: false });
    setSaveError('');
    setDialogOpen(true);
  }

  function openEdit(ann: Announcement) {
    setEditing(ann);
    setForm({ title: ann.title, content: ann.content, level: ann.level, pinned: ann.pinned, published: ann.published });
    setSaveError('');
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      if (editing) {
        await apiFetch(`/admin/announcements/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch('/admin/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      setDialogOpen(false);
      loadData();
    } catch (e: any) {
      setSaveError(e?.error || t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      await apiFetch(`/admin/announcements/${id}`, { method: 'DELETE' });
      loadData();
    } catch (e: any) {
      setError(e?.error || t('deleteFailed'));
    }
  }

  if (authLoading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {tCommon('refresh')}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            {t('create')}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colTitle')}</TableHead>
              <TableHead className="w-24">{t('colLevel')}</TableHead>
              <TableHead className="w-20">{t('colPinned')}</TableHead>
              <TableHead className="w-20">{t('colPublished')}</TableHead>
              <TableHead className="w-40">{t('colCreatedAt')}</TableHead>
              <TableHead className="w-24">{t('colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{tCommon('loading')}</TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
              </TableRow>
            ) : (
              items.map((ann) => (
                <TableRow key={ann.id}>
                  <TableCell className="font-medium">{ann.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={LEVEL_COLORS[ann.level] ?? ''}>
                      {t(`level${ann.level.charAt(0).toUpperCase() + ann.level.slice(1)}` as any)}
                    </Badge>
                  </TableCell>
                  <TableCell>{ann.pinned ? '✓' : ''}</TableCell>
                  <TableCell>{ann.published ? '✓' : ''}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(ann.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(ann)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(ann.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('editTitle') : t('create')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('colTitle')}</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t('titlePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('colLevel')}</Label>
              <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">{t('levelInfo')}</SelectItem>
                  <SelectItem value="warning">{t('levelWarning')}</SelectItem>
                  <SelectItem value="critical">{t('levelCritical')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder={t('contentPlaceholder')}
                rows={6}
              />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.pinned} onCheckedChange={(v) => setForm({ ...form, pinned: v })} />
                <Label>{t('pinned')}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.published} onCheckedChange={(v) => setForm({ ...form, published: v })} />
                <Label>{t('published')}</Label>
              </div>
            </div>
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !form.title}>
              {saving ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
