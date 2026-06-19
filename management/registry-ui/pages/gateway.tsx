import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Node, handler_NodeUpdateRequest } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { RefreshCw, Waypoints, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

// ── Constants ──────────────────────────────────────────────────────────────

const DIRECTIONS = ['domestic', 'overseas', 'global', 'direct'] as const;
const UPSTREAM_MODES = ['auto', 'manual'] as const;

type GatewayField =
  | 'gateway_enabled'
  | 'gateway_direction'
  | 'gateway_upstream_mode'
  | 'gateway_upstream_nodes';

type GatewayPatch = Partial<Pick<model_Node, GatewayField>>;

// ── Multi-select for manual upstream nodes ───────────────────────────────────

function UpstreamMultiSelect({
  candidates, selected, onChange, disabled, placeholder, emptyLabel, searchableLabel,
}: {
  candidates: model_Node[];
  selected: string[];
  onChange: (macs: string[]) => void;
  disabled?: boolean;
  placeholder: string;
  emptyLabel: string;
  searchableLabel: (n: model_Node) => string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(mac: string) {
    onChange(selected.includes(mac) ? selected.filter((m) => m !== mac) : [...selected, mac]);
  }

  const label =
    selected.length === 0
      ? placeholder
      : candidates
          .filter((n) => selected.includes(n.mac ?? ''))
          .map((n) => n.hostname || n.note || n.mac)
          .join(', ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full max-w-[240px] justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-2" align="start">
        {candidates.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.map((n) => {
              const mac = n.mac ?? '';
              const checked = selected.includes(mac);
              return (
                <label
                  key={mac}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(mac)} />
                  <span className="truncate">{searchableLabel(n)}</span>
                </label>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GatewayPage() {
  const t = useTranslations('gateway');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const { user } = useCurrentUser();
  const canWrite = !!user?.can('node:write');

  const [nodes, setNodes] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingMac, setSavingMac] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setNodes(await sessionApi(AdminService.nodesList({})));
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadNodes(); }, [loadNodes]);

  const directionLabel = useMemo(
    () => Object.fromEntries(DIRECTIONS.map((d) => [d, t(`direction.${d}`)])),
    [t],
  );
  const modeLabel = useMemo(
    () => Object.fromEntries(UPSTREAM_MODES.map((m) => [m, t(`mode.${m}`)])),
    [t],
  );

  const patchField = useCallback(async (mac: string, patch: GatewayPatch) => {
    // optimistic update
    setNodes((prev) => prev.map((n) => (n.mac === mac ? { ...n, ...patch } : n)));
    setSavingMac(mac);
    setFeedback(null);
    try {
      await sessionApi(
        AdminService.nodeUpdate({ mac, requestBody: patch as handler_NodeUpdateRequest }),
      );
      setFeedback({ kind: 'ok', msg: t('saved') });
    } catch (e: unknown) {
      setFeedback({ kind: 'err', msg: getErrorMessage(e, t('saveFailed')) });
      loadNodes(); // revert to server truth
    } finally {
      setSavingMac(null);
    }
  }, [t, loadNodes]);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Waypoints className="h-6 w-6" />
            {tNav('gateway')}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadNodes} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Intro / explainer */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('introTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>{t('introWhat')}</p>
          <p>{t('introDirection')}</p>
          <p>{t('introPanel')}</p>
        </CardContent>
      </Card>

      {error && <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {!canWrite && !loading && (
        <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">{t('readOnly')}</div>
      )}
      {feedback && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            feedback.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <GatewayTable
        nodes={nodes}
        loading={loading}
        canWrite={canWrite}
        savingMac={savingMac}
        directionLabel={directionLabel}
        modeLabel={modeLabel}
        onPatch={patchField}
        t={t}
        tCommon={tCommon}
      />
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

function GatewayTable({
  nodes, loading, canWrite, savingMac, directionLabel, modeLabel, onPatch, t, tCommon,
}: {
  nodes: model_Node[];
  loading: boolean;
  canWrite: boolean;
  savingMac: string | null;
  directionLabel: Record<string, string>;
  modeLabel: Record<string, string>;
  onPatch: (mac: string, patch: GatewayPatch) => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  }
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noNodes')}</p>;
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colHostname')}</TableHead>
            <TableHead>{t('colLocation')}</TableHead>
            <TableHead>{t('colEnabled')}</TableHead>
            <TableHead>{t('colDirection')}</TableHead>
            <TableHead>{t('colMode')}</TableHead>
            <TableHead>{t('colUpstreams')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((n) => {
            const mac = n.mac ?? '';
            const enabled = !!n.gateway_enabled;
            const direction = n.gateway_direction || 'domestic';
            const mode = n.gateway_upstream_mode || 'auto';
            const selectedUpstreams = (n.gateway_upstream_nodes ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            const candidates = nodes.filter((c) => c.mac && c.mac !== mac);
            const rowDisabled = !canWrite || savingMac === mac;

            return (
              <TableRow key={mac} className={savingMac === mac ? 'opacity-60' : ''}>
                <TableCell className="font-medium">{n.hostname || n.note || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{n.location || '—'}</TableCell>
                <TableCell>
                  <Switch
                    checked={enabled}
                    disabled={rowDisabled}
                    aria-label={t('colEnabled')}
                    onCheckedChange={(v) => onPatch(mac, { gateway_enabled: v })}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={direction}
                    disabled={rowDisabled || !enabled}
                    onValueChange={(v) => onPatch(mac, { gateway_direction: v })}
                  >
                    <SelectTrigger size="sm" className="w-[140px]" aria-label={t('colDirection')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIRECTIONS.map((d) => (
                        <SelectItem key={d} value={d}>{directionLabel[d]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={mode}
                    disabled={rowDisabled || !enabled}
                    onValueChange={(v) => onPatch(mac, { gateway_upstream_mode: v })}
                  >
                    <SelectTrigger size="sm" className="w-[120px]" aria-label={t('colMode')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UPSTREAM_MODES.map((m) => (
                        <SelectItem key={m} value={m}>{modeLabel[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {mode === 'manual' && enabled ? (
                    <UpstreamMultiSelect
                      candidates={candidates}
                      selected={selectedUpstreams}
                      disabled={rowDisabled}
                      placeholder={t('selectUpstreams')}
                      emptyLabel={t('noOtherNodes')}
                      searchableLabel={(c) => c.hostname || c.note || c.mac || '—'}
                      onChange={(macs) => onPatch(mac, { gateway_upstream_nodes: macs.join(',') })}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('autoUpstream')}</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
