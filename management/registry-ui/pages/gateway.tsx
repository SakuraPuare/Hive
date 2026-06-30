import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
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
  const listboxId = useId();

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
          aria-haspopup="listbox"
          aria-controls={listboxId}
          disabled={disabled}
          className="w-full max-w-[240px] justify-between rounded-lg border-border bg-card font-normal
            text-sm text-foreground hover:bg-md-surface-container-high
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
            disabled:pointer-events-none disabled:opacity-40"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[260px] rounded-xl border border-border bg-popover p-2 elevation-2 animate-scale-in"
        align="start"
      >
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable
          className="max-h-64 space-y-0.5 overflow-y-auto"
        >
          {candidates.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">{emptyLabel}</p>
          ) : (
            candidates.map((n) => {
              const mac = n.mac ?? '';
              const checked = selected.includes(mac);
              return (
                <label
                  key={mac}
                  role="option"
                  aria-selected={checked}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm
                    hover-state text-foreground transition-colors"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(mac)}
                    className="rounded border-md-outline data-[state=checked]:bg-md-primary data-[state=checked]:border-md-primary"
                  />
                  <span className="truncate">{searchableLabel(n)}</span>
                </label>
              );
            })
          )}
        </div>
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
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl
            bg-md-primary-container text-md-on-primary-container">
            <Waypoints className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-600 tracking-tight text-foreground">
              {tNav('gateway')}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        <button
          onClick={loadNodes}
          disabled={loading}
          aria-label={tCommon('refresh')}
          className="state-layer ripple inline-flex h-9 w-9 shrink-0 items-center justify-center
            rounded-full border border-border bg-card text-muted-foreground
            disabled:pointer-events-none disabled:opacity-40
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Intro / explainer */}
      <Card
        className="rounded-xl border border-border bg-card animate-slide-up"
        style={{ animationDelay: '40ms' }}
      >
        <CardHeader className="pb-2 pt-5 px-5">
          <CardTitle className="font-display text-base font-600 text-foreground">
            {t('introTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
          <p>{t('introWhat')}</p>
          <p>{t('introDirection')}</p>
          <p>{t('introPanel')}</p>
        </CardContent>
      </Card>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl bg-md-error-container px-4 py-3 text-sm
          text-md-on-error-container animate-slide-up">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-md-error" />
          {error}
        </div>
      )}

      {/* Read-only notice */}
      {!canWrite && !loading && (
        <div className="rounded-xl bg-md-surface-container-high px-4 py-3 text-sm
          text-muted-foreground animate-slide-up">
          {t('readOnly')}
        </div>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm animate-slide-up ${
            feedback.kind === 'ok'
              ? 'bg-md-tertiary-container text-md-on-tertiary-container'
              : 'bg-md-error-container text-md-on-error-container'
          }`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              feedback.kind === 'ok' ? 'bg-md-tertiary' : 'bg-md-error'
            }`}
          />
          {feedback.msg}
        </div>
      )}

      <div className="animate-slide-up" style={{ animationDelay: '80ms' }}>
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
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border
        bg-card py-16 text-muted-foreground">
        {/* M3 circular progress — CSS-only indeterminate spinner */}
        <div
          className="h-10 w-10 rounded-full border-[3px] border-md-surface-container-highest
            border-t-md-primary animate-spin"
          role="progressbar"
          aria-label={tCommon('loading')}
        />
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border
        bg-card py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-md-surface-container-high">
          <Waypoints className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-500 text-foreground">{t('noNodes')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-md-surface-container-high hover:bg-md-surface-container-high border-b border-border">
            <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colHostname')}
            </TableHead>
            <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colLocation')}
            </TableHead>
            <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colEnabled')}
            </TableHead>
            <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colDirection')}
            </TableHead>
            <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colMode')}
            </TableHead>
            <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colUpstreams')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((n, i) => {
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
              <TableRow
                key={mac}
                className={`hover-state border-b border-border last:border-b-0 transition-opacity
                  animate-slide-up ${savingMac === mac ? 'opacity-50' : ''}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* Hostname */}
                <TableCell className="py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        enabled ? 'bg-md-tertiary' : 'bg-md-outline'
                      }`}
                    />
                    <span className="font-500 text-sm text-foreground">
                      {n.hostname || n.note || '—'}
                    </span>
                  </div>
                </TableCell>

                {/* Location */}
                <TableCell className="py-3">
                  <span className="text-sm text-muted-foreground">{n.location || '—'}</span>
                </TableCell>

                {/* Enabled toggle */}
                <TableCell className="py-3">
                  <Switch
                    checked={enabled}
                    disabled={rowDisabled}
                    aria-label={t('colEnabled')}
                    onCheckedChange={(v) => onPatch(mac, { gateway_enabled: v })}
                  />
                </TableCell>

                {/* Direction */}
                <TableCell className="py-3">
                  <Select
                    value={direction}
                    disabled={rowDisabled || !enabled}
                    onValueChange={(v) => onPatch(mac, { gateway_direction: v })}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-[140px] rounded-lg border-border bg-md-surface-container
                        text-sm focus:ring-2 focus:ring-md-primary focus:ring-offset-1
                        disabled:opacity-40"
                      aria-label={t('colDirection')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border bg-popover elevation-2 animate-scale-in">
                      {DIRECTIONS.map((d) => (
                        <SelectItem
                          key={d}
                          value={d}
                          className="rounded-lg text-sm hover:bg-md-surface-container-high"
                        >
                          {directionLabel[d]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                {/* Mode */}
                <TableCell className="py-3">
                  <Select
                    value={mode}
                    disabled={rowDisabled || !enabled}
                    onValueChange={(v) => onPatch(mac, { gateway_upstream_mode: v })}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-[120px] rounded-lg border-border bg-md-surface-container
                        text-sm focus:ring-2 focus:ring-md-primary focus:ring-offset-1
                        disabled:opacity-40"
                      aria-label={t('colMode')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border bg-popover elevation-2 animate-scale-in">
                      {UPSTREAM_MODES.map((m) => (
                        <SelectItem
                          key={m}
                          value={m}
                          className="rounded-lg text-sm hover:bg-md-surface-container-high"
                        >
                          {modeLabel[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                {/* Upstreams */}
                <TableCell className="py-3">
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
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5
                      text-xs font-500 bg-muted text-muted-foreground">
                      {t('autoUpstream')}
                    </span>
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
