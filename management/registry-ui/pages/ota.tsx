import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useCurrentUser } from '@/lib/auth';
import { apiPath } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { Loader2, Plus, RefreshCw, Upload, ChevronLeft, Eye, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

// ── Session API helpers, including raw upload chunks ────────────────────────

async function otaFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(apiPath(path), {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (res.status === 401 || res.status === 403) {
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
  const body = await res.json();
  if (!res.ok) throw { error: body.error || 'request failed', status: res.status };
  return body as T;
}

async function otaRetryFetch<T>(path: string, opts: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await otaFetch<T>(path, opts); }
    catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

type Rollout = {
  id: number;
  version: string;
  url: string;
  sha256: string;
  note: string;
  created_by: string;
  created_at: string;
  total: number;
  pending: number;
  done: number;
  failed: number;
  installing: number;
  rolled_back: number;
};

type Assignment = {
  node_mac: string;
  rollout_id: number;
  status: 'pending' | 'installing' | 'done' | 'failed' | 'rolled_back';
  result: string;
  assigned_at: string;
  acked_at: string | null;
};

type RolloutDetail = {
  rollout: Omit<Rollout, 'total' | 'pending' | 'done' | 'failed'>;
  assignments: Assignment[];
};

// ── Status badge helper ─────────────────────────────────────────────────────

function StatusBadge({ status, label }: { status: string; label: string }) {
  const variant = status === 'done' ? 'success' : ['failed', 'rolled_back'].includes(status) ? 'destructive' : 'warning';
  return <Badge variant={variant}>{label}</Badge>;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function OtaPage() {
  const t = useTranslations('ota');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const fmt = useFormat();
  const { user, loading: authLoading } = useCurrentUser();

  const [rollouts, setRollouts] = useState<Rollout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Detail view
  const [detail, setDetail] = useState<RolloutDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formVersion, setFormVersion] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formSha256, setFormSha256] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formNodeMacs, setFormNodeMacs] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadedKind, setUploadedKind] = useState('');
  const [uploadedBoard, setUploadedBoard] = useState('');

  // Assign dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignRolloutId, setAssignRolloutId] = useState<number | null>(null);
  const [assignNodeMacs, setAssignNodeMacs] = useState('');

  // ── Auth guard ────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.can('ota:read')) { router.replace('/dashboard'); return; }
  }, [authLoading, user, router]);

  // ── Fetch rollouts ────────────────────────────────────────────────────
  const fetchRollouts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await otaFetch<Rollout[]>('/admin/ota/rollouts');
      setRollouts(data || []);
    } catch (e) {
      setError(getErrorMessage(e, t('fetchError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchRollouts(); }, [fetchRollouts]);

  // ── Fetch detail ──────────────────────────────────────────────────────
  const openDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const data = await otaFetch<RolloutDetail>(`/admin/ota/rollouts/${id}`);
      setDetail(data);
    } catch (e) {
      toast.error(getErrorMessage(e, t('fetchError')));
    } finally {
      setDetailLoading(false);
    }
  }, [t, toast]);

  const handleUpload = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 ** 3) { toast.error(t('uploadTooLarge')); return; }
    setUploading(true);
    setUploadPercent(0);
    try {
      const session = await otaFetch<{ id: string; chunk_size: number }>('/admin/ota/uploads', {
        method: 'POST', body: JSON.stringify({ size: file.size }),
      });
      for (let offset = 0, part = 0; offset < file.size; offset += session.chunk_size, part++) {
        const chunk = file.slice(offset, offset + session.chunk_size);
        await otaRetryFetch(`/admin/ota/uploads/${session.id}/${part}`, {
          method: 'PUT', body: chunk, headers: { 'Content-Type': 'application/octet-stream' },
        });
        setUploadPercent(Math.round(Math.min(file.size, offset + session.chunk_size) / file.size * 100));
      }
      const data = await otaRetryFetch<{ version: string; url: string; sha256: string; kind: string; board?: string }>(`/admin/ota/uploads/${session.id}/complete`, { method: 'POST' });
      setFormVersion(data.version); setFormUrl(data.url); setFormSha256(data.sha256);
      setUploadedName(file.name); setUploadedKind(data.kind);
      setUploadedBoard(data.board || '');
      toast.success(t('uploadSuccess'));
    } catch (e) { toast.error(getErrorMessage(e, t('uploadError'))); }
    finally { setUploading(false); }
  };

  // ── Create rollout ────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!formVersion || !formUrl || !formSha256) return;
    setCreating(true);
    try {
      const macs = formNodeMacs.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
      await otaFetch<{ id: number; assigned: number }>('/admin/ota/rollouts', {
        method: 'POST',
        body: JSON.stringify({
          version: formVersion,
          url: formUrl,
          sha256: formSha256,
          note: formNote,
          node_macs: macs.length > 0 ? macs : undefined,
        }),
      });
      toast.success(t('createSuccess'));
      setCreateOpen(false);
      setFormVersion(''); setFormUrl(''); setFormSha256(''); setFormNote(''); setFormNodeMacs(''); setUploadedName(''); setUploadedKind(''); setUploadedBoard('');
      fetchRollouts();
    } catch (e) {
      toast.error(getErrorMessage(e, t('createError')));
    } finally {
      setCreating(false);
    }
  };

  // ── Assign nodes ──────────────────────────────────────────────────────
  const handleAssign = async () => {
    if (!assignRolloutId || !assignNodeMacs.trim()) return;
    setAssigning(true);
    try {
      const macs = assignNodeMacs.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
      const res = await otaFetch<{ assigned: number }>(`/admin/ota/rollouts/${assignRolloutId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ node_macs: macs }),
      });
      toast.success(t('assignSuccess', { count: res.assigned }));
      setAssignOpen(false);
      setAssignNodeMacs('');
      fetchRollouts();
      if (detail?.rollout.id === assignRolloutId) openDetail(assignRolloutId);
    } catch (e) {
      toast.error(getErrorMessage(e, t('assignError')));
    } finally {
      setAssigning(false);
    }
  };

  if (authLoading || !user) return null;

  // ── Detail view ───────────────────────────────────────────────────────
  if (detail) {
    const ro = detail.rollout;
    const assignments = detail.assignments || [];
    const pending = assignments.filter(a => ['pending', 'installing'].includes(a.status)).length;
    const done = assignments.filter(a => a.status === 'done').length;
    const failed = assignments.filter(a => ['failed', 'rolled_back'].includes(a.status)).length;

    return (
      <PageContainer>
        <PageHeader
          icon={<Upload />}
          title={`${t('rollout')} v${ro.version}`}
          description={ro.note || `ID #${ro.id}`}
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> {tCommon('back')}
              </Button>
              {user.can('ota:write') && (
                <Button size="sm" onClick={() => {
                  setAssignRolloutId(ro.id);
                  setAssignOpen(true);
                }}>
                  <Send className="mr-1 h-4 w-4" /> {t('assignNodes')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => openDetail(ro.id)} disabled={detailLoading}>
                {detailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          }
        />

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-600">{assignments.length}</div>
            <div className="text-xs text-muted-foreground">{t('total')}</div>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-600 text-[hsl(43_96%_40%)]">{pending}</div>
            <div className="text-xs text-muted-foreground">{t('statusPending')}</div>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-600 text-md-tertiary">{done}</div>
            <div className="text-xs text-muted-foreground">{t('statusDone')}</div>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-600 text-md-error">{failed}</div>
            <div className="text-xs text-muted-foreground">{t('statusFailed')}</div>
          </CardContent></Card>
        </div>

        <Card className="mt-4">
          <CardContent className="space-y-2 py-4 text-sm">
            <div><span className="text-muted-foreground">URL:</span> <span className="break-all font-mono text-xs">{ro.url}</span></div>
            <div><span className="text-muted-foreground">SHA256:</span> <span className="break-all font-mono text-xs">{ro.sha256}</span></div>
            <div><span className="text-muted-foreground">{t('createdBy')}:</span> {ro.created_by}</div>
            <div><span className="text-muted-foreground">{t('createdAt')}:</span> {fmt.dateTime(ro.created_at)}</div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colMac')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colResult')}</TableHead>
                <TableHead>{t('colAssignedAt')}</TableHead>
                <TableHead>{t('colAckedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">{t('noAssignments')}</TableCell></TableRow>
              ) : assignments.map(a => (
                <TableRow key={a.node_mac}>
                  <TableCell className="font-mono text-xs">{a.node_mac}</TableCell>
                  <TableCell><StatusBadge status={a.status} label={
                    a.status === 'done' ? t('statusDone') : a.status === 'failed' ? t('statusFailed') : a.status === 'rolled_back' ? t('statusRolledBack') : a.status === 'installing' ? t('statusInstalling') : t('statusPending')
                  } /></TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs">{a.result || '—'}</TableCell>
                  <TableCell className="text-xs">{fmt.dateTime(a.assigned_at)}</TableCell>
                  <TableCell className="text-xs">{fmt.dateTime(a.acked_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {/* Assign dialog */}
        <AssignDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          loading={assigning}
          nodeMacs={assignNodeMacs}
          setNodeMacs={setAssignNodeMacs}
          onSubmit={handleAssign}
          t={t}
          tCommon={tCommon}
        />
      </PageContainer>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        icon={<Upload />}
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex gap-2">
            {user.can('ota:write') && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> {t('createRollout')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={fetchRollouts} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mt-4 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container">
          {error}
        </div>
      )}

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>{t('colVersion')}</TableHead>
              <TableHead>{t('colProgress')}</TableHead>
              <TableHead>{t('colNote')}</TableHead>
              <TableHead>{t('createdBy')}</TableHead>
              <TableHead>{t('createdAt')}</TableHead>
              <TableHead>{tCommon('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
              </TableCell></TableRow>
            ) : rollouts.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                {t('noRollouts')}
              </TableCell></TableRow>
            ) : rollouts.map(ro => (
              <TableRow key={ro.id}>
                <TableCell className="font-mono text-xs">#{ro.id}</TableCell>
                <TableCell className="font-600">v{ro.version}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-md-tertiary">{ro.done}</span>
                    <span className="text-muted-foreground">/</span>
                    <span>{ro.total}</span>
                    {ro.failed > 0 && <Badge variant="destructive" className="ml-1">{ro.failed} {t('statusFailed')}</Badge>}
                    {ro.installing > 0 && <Badge variant="warning">{ro.installing} {t('statusInstalling')}</Badge>}
                    {ro.rolled_back > 0 && <Badge variant="destructive">{ro.rolled_back} {t('statusRolledBack')}</Badge>}
                    {ro.pending > 0 && <Badge variant="warning" className="ml-1">{ro.pending} {t('statusPending')}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="max-w-[150px] truncate text-xs">{ro.note || '—'}</TableCell>
                <TableCell className="text-xs">{ro.created_by}</TableCell>
                <TableCell className="text-xs">{fmt.dateTime(ro.created_at)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openDetail(ro.id)} disabled={detailLoading}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    {user.can('ota:write') && (
                      <Button variant="ghost" size="sm" onClick={() => {
                        setAssignRolloutId(ro.id);
                        setAssignOpen(true);
                      }}>
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Create rollout dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('createRollout')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ota-bundle">{t('uploadBundle')}</Label>
              <Input id="ota-bundle" type="file" accept=".tar.gz,.tgz" disabled={uploading || creating}
                onChange={e => { void handleUpload(e.target.files?.[0]); e.target.value = ''; }} />
              <p className="text-xs text-muted-foreground">{uploading ? `${t('uploading')} ${uploadPercent}%` : uploadedName || t('uploadHint')}</p>
              {uploadedName && uploadedKind === 'firmware' && <p className="text-sm">{t('firmwareNotice', { board: uploadedBoard })}</p>}
              {uploadedName && <Button variant="outline" size="sm" onClick={() => { setUploadedName(''); setUploadedKind(''); setUploadedBoard(''); setFormUrl(''); setFormSha256(''); }}>{t('useExternalUrl')}</Button>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ota-version">{t('fieldVersion')}</Label>
              <Input id="ota-version" disabled={!!uploadedName} value={formVersion} onChange={e => setFormVersion(e.target.value)} placeholder="1.0.0" />
            </div>
            {!uploadedName && <div className="space-y-1.5">
              <Label htmlFor="ota-url">{t('fieldUrl')}</Label>
              <Input id="ota-url" value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://..." />
            </div>}
            <div className="space-y-1.5">
              <Label>SHA256</Label>
              <Input disabled={!!uploadedName} value={formSha256} onChange={e => setFormSha256(e.target.value)} placeholder="64 hex chars" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fieldNote')}</Label>
              <Input value={formNote} onChange={e => setFormNote(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fieldNodeMacs')}</Label>
              <Input value={formNodeMacs} onChange={e => setFormNodeMacs(e.target.value)} placeholder={t('fieldNodeMacsHint')} />
              <p className="text-xs text-muted-foreground">{t('fieldNodeMacsHelp')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleCreate} disabled={creating || uploading || !formVersion || !formUrl || !formSha256}>
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        loading={assigning}
        nodeMacs={assignNodeMacs}
        setNodeMacs={setAssignNodeMacs}
        onSubmit={handleAssign}
        t={t}
        tCommon={tCommon}
      />
    </PageContainer>
  );
}

// ── Assign Dialog (shared between list and detail views) ────────────────────

function AssignDialog({
  open, onOpenChange, loading, nodeMacs, setNodeMacs, onSubmit, t, tCommon,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  nodeMacs: string;
  setNodeMacs: (v: string) => void;
  onSubmit: () => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('assignNodes')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('fieldNodeMacs')}</Label>
            <Input value={nodeMacs} onChange={e => setNodeMacs(e.target.value)} placeholder={t('fieldNodeMacsHint')} />
            <p className="text-xs text-muted-foreground">{t('fieldNodeMacsHelp')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tCommon('cancel')}</Button>
          <Button onClick={onSubmit} disabled={loading || !nodeMacs.trim()}>
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('assign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
