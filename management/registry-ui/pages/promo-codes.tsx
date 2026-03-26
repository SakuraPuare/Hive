import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_PromoCode } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
    <div className="space-y-3 py-2">
      <div><Label>{t('code')}</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>{t('discountPct')}</Label><Input type="number" value={form.discount_pct} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })} placeholder="0-100" /></div>
        <div><Label>{t('discountAmt')}</Label><Input type="number" value={form.discount_amt} onChange={(e) => setForm({ ...form, discount_amt: e.target.value })} placeholder="0" /></div>
      </div>
      <div><Label>{t('maxUses')}</Label><Input type="number" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="0 = unlimited" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>{t('validFrom')}</Label><Input type="datetime-local" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></div>
        <div><Label>{t('validTo')}</Label><Input type="datetime-local" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="pc-enabled" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4" />
        <Label htmlFor="pc-enabled">{t('enabled')}</Label>
      </div>
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
      setCodes(Array.isArray(data) ? data : (data as any).promo_codes ?? []);
    } catch (e: any) { setError(e?.error || t('loadFailed')); }
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
        valid_from: createForm.valid_from || null,
        valid_to: createForm.valid_to || null,
        enabled: createForm.enabled,
      }}));
      setCreateOpen(false); loadCodes();
    } catch (e: any) { setCreateError(e?.error || t('createFailed')); }
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
        valid_from: editForm.valid_from || null,
        valid_to: editForm.valid_to || null,
        enabled: editForm.enabled,
      }}));
      setEditTarget(null); loadCodes();
    } catch (e: any) { setEditError(e?.error || t('updateFailed')); }
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
    } catch (e: any) { alert(e?.error || t('deleteFailed')); }
    finally { setDeleting(false); }
  }

  if (authLoading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadCodes} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />{tCommon('refresh')}
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => { setCreateForm(emptyForm); setCreateError(''); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />{t('create')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colCode')}</TableHead>
              <TableHead>{t('colDiscountPct')}</TableHead>
              <TableHead>{t('colDiscountAmt')}</TableHead>
              <TableHead>{t('colMaxUses')}</TableHead>
              <TableHead>{t('colUsedCount')}</TableHead>
              <TableHead>{t('colValidFrom')}</TableHead>
              <TableHead>{t('colValidTo')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              {canWrite && <TableHead>{t('colActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={canWrite ? 9 : 8} className="text-center py-8 text-muted-foreground">{tCommon('loading')}</TableCell></TableRow>
            ) : codes.length === 0 ? (
              <TableRow><TableCell colSpan={canWrite ? 9 : 8} className="text-center py-8 text-muted-foreground">{t('noCodes')}</TableCell></TableRow>
            ) : codes.map((pc) => (
              <TableRow key={pc.id}>
                <TableCell className="font-mono font-medium">{pc.code}</TableCell>
                <TableCell>{(pc.discount_pct ?? 0) > 0 ? `${pc.discount_pct}%` : '—'}</TableCell>
                <TableCell>{(pc.discount_amt ?? 0) > 0 ? `¥${((pc.discount_amt ?? 0) / 100).toFixed(2)}` : '—'}</TableCell>
                <TableCell>{(pc.max_uses ?? 0) === 0 ? t('unlimited') : pc.max_uses}</TableCell>
                <TableCell>{pc.used_count ?? 0}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDate(pc.valid_from ?? '')}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDate(pc.valid_to ?? '')}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={(pc.enabled ?? false) ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                    {(pc.enabled ?? false) ? t('enabled') : t('disabled')}
                  </Badge>
                </TableCell>
                {canWrite && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(pc)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(pc)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('create')}</DialogTitle></DialogHeader>
          <PromoForm form={createForm} setForm={setCreateForm} t={t as any} />
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleCreate} disabled={creating || !createForm.code}>{creating ? tCommon('saving') : tCommon('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('edit')}</DialogTitle></DialogHeader>
          <PromoForm form={editForm} setForm={setEditForm} t={t as any} />
          {editError && <p className="text-sm text-destructive">{editError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{tCommon('cancel')}</Button>
            <Button onClick={handleEdit} disabled={editing || !editForm.code}>{editing ? tCommon('saving') : tCommon('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tCommon('delete')}</DialogTitle></DialogHeader>
          <p className="py-2 text-sm">{t('deleteConfirm', { code: deleteTarget?.code ?? '' })}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{tCommon('cancel')}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{tCommon('delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
