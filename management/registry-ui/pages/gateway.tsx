import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Node, handler_NodeUpdateRequest } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { RefreshCw, Waypoints, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Collapsible } from 'radix-ui';

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
// Maintains local draft state; flushes to onPatch with a 300ms debounce to
// prevent a burst of concurrent PATCHes when the user toggles multiple items.

function UpstreamMultiSelect({
  candidates, selected, onChange, disabled, placeholder, emptyLabel,
  searchableLabel, searchPlaceholder, hint, selectedLabel, notSelectedLabel,
}: {
  candidates: model_Node[];
  selected: string[];
  onChange: (macs: string[]) => void;
  disabled?: boolean;
  placeholder: string;
  emptyLabel: string;
  searchableLabel: (n: model_Node) => string;
  searchPlaceholder: string;
  hint: string;
  selectedLabel: string;
  notSelectedLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Local draft: checkbox clicks update this immediately; onChange is flushed
  // after a 300ms debounce so rapid multi-select produces a single PATCH.
  const [draft, setDraft] = useState<string[]>(selected);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintId = useId();
  const listboxId = useId();

  // Sync draft when external `selected` changes (e.g. after a server revert).
  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    if (prevSelectedRef.current !== selected) {
      prevSelectedRef.current = selected;
      setDraft(selected);
    }
  }, [selected]);

  function toggle(mac: string) {
    setDraft((prev) => {
      const next = prev.includes(mac) ? prev.filter((m) => m !== mac) : [...prev, mac];
      // Debounce flush: cancel any pending timer and schedule a new one.
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { onChange(next); }, 300);
      return next;
    });
  }

  // Flush immediately when the popover closes to avoid dangling timers.
  function handleOpenChange(next: boolean) {
    if (!next && debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      onChange(draft);
    }
    setOpen(next);
  }

  const label =
    draft.length === 0
      ? placeholder
      : candidates
          .filter((n) => draft.includes(n.mac ?? ''))
          .map((n) => n.hostname || n.note || n.mac)
          .join(', ');

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          aria-describedby={hintId}
          disabled={disabled}
          className="w-full max-w-[240px] justify-between rounded-lg border-border bg-card font-normal
            text-sm text-foreground hover:bg-md-surface-container-high
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
            disabled:pointer-events-none disabled:opacity-40"
        >
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <span id={hintId} className="sr-only">{hint}</span>
      <PopoverContent
        id={listboxId}
        className="w-[260px] rounded-xl border border-border bg-popover p-0 elevation-2 animate-scale-in"
        align="start"
      >
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            clearable
            clearLabel={emptyLabel}
          />
          <CommandList className="max-h-64">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {candidates.map((n) => {
                const mac = n.mac ?? '';
                const checked = draft.includes(mac);
                return (
                  <CommandItem
                    key={mac}
                    value={`${searchableLabel(n)} ${mac}`}
                    onSelect={() => toggle(mac)}
                  >
                    <Checkbox
                      checked={checked}
                      aria-hidden="true"
                      tabIndex={-1}
                      className="pointer-events-none rounded border-md-outline
                        data-[state=checked]:bg-md-primary data-[state=checked]:border-md-primary"
                    />
                    <span className="truncate">{searchableLabel(n)}</span>
                    <span className="sr-only">{checked ? selectedLabel : notSelectedLabel}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Collapsible intro card ────────────────────────────────────────────────────

const INTRO_STORAGE_KEY = 'gateway-intro-collapsed';

function IntroCard({ t }: { t: ReturnType<typeof useTranslations> }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(INTRO_STORAGE_KEY) !== 'true';
  });

  function handleOpenChange(v: boolean) {
    setOpen(v);
    try { localStorage.setItem(INTRO_STORAGE_KEY, String(!v)); } catch { /* ignore */ }
  }

  return (
    <Collapsible.Root open={open} onOpenChange={handleOpenChange}>
      <Card className="rounded-xl border border-border bg-card animate-slide-up" style={{ animationDelay: '40ms' }}>
        <CardHeader className="pb-2 pt-5 px-5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="font-display text-base font-600 text-foreground">
              {t('introTitle')}
            </CardTitle>
            <Collapsible.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={open ? t('collapseIntro') : t('expandIntro')}
                className="shrink-0 text-muted-foreground"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                />
              </Button>
            </Collapsible.Trigger>
          </div>
        </CardHeader>
        <Collapsible.Content>
          <CardContent className="space-y-2 px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
            <p>{t('introWhat')}</p>
            <p>{t('introDirection')}</p>
            <p>{t('introPanel')}</p>
          </CardContent>
        </Collapsible.Content>
      </Card>
    </Collapsible.Root>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GatewayPage() {
  const t = useTranslations('gateway');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const toast = useToast();
  const { user } = useCurrentUser();
  const canWrite = !!user?.can('node:write');

  const [nodes, setNodes] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // P1 fix: Set instead of scalar so concurrent row saves are tracked independently.
  const [savingMacs, setSavingMacs] = useState<Set<string>>(new Set());

  // nodesRef: always current; used inside patchField to avoid stale closure
  // without listing `nodes` in patchField's deps (which would recreate it on
  // every optimistic update and risk capturing the wrong pre-save snapshot).
  const nodesRef = useRef<model_Node[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const loadNodes = useCallback(async (isInitial = false) => {
    // Only show the full loading skeleton on the initial fetch; subsequent
    // refreshes keep the existing table visible to avoid a jarring blank-redraw.
    if (isInitial) setLoading(true);
    setError('');
    try {
      setNodes(await sessionApi(AdminService.nodesList({})));
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadNodes(true); }, [loadNodes]);

  const directionLabel = useMemo(
    () => Object.fromEntries(DIRECTIONS.map((d) => [d, t(`direction.${d}`)])),
    [t],
  );
  const modeLabel = useMemo(
    () => Object.fromEntries(UPSTREAM_MODES.map((m) => [m, t(`mode.${m}`)])),
    [t],
  );

  const patchFieldRef = useRef<(mac: string, patch: GatewayPatch, allowUndo?: boolean) => void>(undefined);
  const patchField = useCallback(async (mac: string, patch: GatewayPatch, allowUndo = true) => {
    // Use nodesRef (not the `nodes` closure) so the revert snapshot is always
    // taken from the current list at call time, even if concurrent saves have
    // already applied optimistic updates to `nodes` state.
    const current = nodesRef.current.find((n) => n.mac === mac);
    const revert: GatewayPatch = {};
    if (current && allowUndo) {
      (Object.keys(patch) as GatewayField[]).forEach((k) => {
        (revert as Record<string, unknown>)[k] = current[k];
      });
    }
    // Snapshot the pre-optimistic node for local rollback on error.
    const preOptimistic = current ? { ...current } : undefined;
    // optimistic update
    setNodes((prev) => prev.map((n) => (n.mac === mac ? { ...n, ...patch } : n)));
    setSavingMacs((prev) => new Set([...prev, mac]));
    try {
      await sessionApi(
        AdminService.nodeUpdate({ mac, requestBody: patch as handler_NodeUpdateRequest }),
      );
      toast.success(
        t('saved'),
        allowUndo
          ? { action: { label: tCommon('undo'), onClick: () => patchFieldRef.current?.(mac, revert, false) } }
          : undefined,
      );
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('saveFailed')));
      // Revert optimistic update locally — no full reload so the table stays
      // visible. If the server state diverged in a more complex way the user
      // can press Refresh explicitly.
      if (preOptimistic) {
        setNodes((prev) => prev.map((n) => (n.mac === mac ? preOptimistic : n)));
      }
    } finally {
      setSavingMacs((prev) => { const s = new Set(prev); s.delete(mac); return s; });
    }
  }, [t, tCommon, toast]);
  useEffect(() => { patchFieldRef.current = patchField; }, [patchField]);

  return (
    <PageContainer>
      <PageHeader
        icon={<Waypoints />}
        title={tNav('gateway')}
        description={t('subtitle')}
        actions={
          <Button
            variant="outline"
            size="icon-xl"
            onClick={() => loadNodes()}
            loading={loading}
            aria-label={tCommon('refresh')}
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
          </Button>
        }
      />

      <IntroCard t={t} />

      {/* Error banner — persistent status, announced + retry affordance */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-md-error-container px-4 py-3 text-sm
            text-md-on-error-container animate-slide-up"
        >
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-md-error" />
          <span className="flex-1">{error}</span>
          <Button
            variant="link"
            size="sm"
            onClick={() => loadNodes()}
            className="h-auto p-0 text-md-on-error-container underline"
          >
            {tCommon('retry')}
          </Button>
        </div>
      )}

      {/* Read-only notice */}
      {!canWrite && !loading && (
        <div className="rounded-xl bg-md-surface-container-high px-4 py-3 text-sm
          text-muted-foreground animate-slide-up">
          {t('readOnly')}
        </div>
      )}

      <div className="animate-slide-up" style={{ animationDelay: '80ms' }}>
        <GatewayTable
          nodes={nodes}
          loading={loading}
          canWrite={canWrite}
          savingMacs={savingMacs}
          directionLabel={directionLabel}
          modeLabel={modeLabel}
          onPatch={patchField}
          t={t}
          tCommon={tCommon}
        />
      </div>
    </PageContainer>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

function GatewayTable({
  nodes, loading, canWrite, savingMacs, directionLabel, modeLabel, onPatch, t, tCommon,
}: {
  nodes: model_Node[];
  loading: boolean;
  canWrite: boolean;
  savingMacs: Set<string>;
  directionLabel: Record<string, string>;
  modeLabel: Record<string, string>;
  onPatch: (mac: string, patch: GatewayPatch) => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  if (loading) {
    return (
      <div
        aria-busy="true"
        className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border
          bg-card py-16 text-muted-foreground"
      >
        {/* M3 circular progress — CSS-only indeterminate spinner */}
        <div
          className="h-10 w-10 rounded-full border-[3px] border-md-surface-container-highest
            border-t-md-primary animate-spin"
          role="progressbar"
          aria-label={tCommon('loading')}
        />
        <p aria-live="polite" className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border
        bg-card py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-md-surface-container-high">
          <Waypoints aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-500 text-foreground">{t('noNodes')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card" aria-busy={savingMacs.size > 0}>
      <Table aria-label={t('tableLabel')}>
        <TableHeader>
          <TableRow className="bg-md-surface-container-high hover:bg-md-surface-container-high border-b border-border">
            <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colHostname')}
            </TableHead>
            <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colLocation')}
            </TableHead>
            <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colEnabled')}
            </TableHead>
            <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colDirection')}
            </TableHead>
            <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
              {t('colMode')}
            </TableHead>
            <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
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
            const isSaving = savingMacs.has(mac);
            const rowDisabled = !canWrite || isSaving;
            // P2 fix: only show "enable gateway first" tooltip when the row is
            // NOT mid-save; during a save the opacity-50 already signals busy.
            const lockedByGateway = rowDisabled || !enabled;
            const showEnableFirstHint = !isSaving && !enabled && canWrite;

            return (
              <TableRow
                key={mac}
                className={`hover-state border-b border-border last:border-b-0 transition-opacity
                  animate-slide-up ${isSaving ? 'opacity-50' : ''}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* Hostname */}
                <TableCell className="py-3">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
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
                    aria-label={enabled ? t('switchEnabled') : t('switchDisabled')}
                    onLabel={t('switchEnabled')}
                    offLabel={t('switchDisabled')}
                    onCheckedChange={(v) => onPatch(mac, { gateway_enabled: v })}
                  />
                </TableCell>

                {/* Direction */}
                <TableCell className="py-3">
                  <DisabledHint locked={showEnableFirstHint} hint={t('enableFirst')}>
                    <Select
                      value={direction}
                      disabled={lockedByGateway}
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
                  </DisabledHint>
                </TableCell>

                {/* Mode */}
                <TableCell className="py-3">
                  <DisabledHint locked={showEnableFirstHint} hint={t('enableFirst')}>
                    <Select
                      value={mode}
                      disabled={lockedByGateway}
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
                  </DisabledHint>
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
                      searchPlaceholder={t('searchUpstreams')}
                      hint={t('upstreamHint')}
                      selectedLabel={t('upstreamSelected')}
                      notSelectedLabel={t('upstreamNotSelected')}
                      onChange={(macs) => onPatch(mac, { gateway_upstream_nodes: macs.join(',') })}
                    />
                  ) : (
                    <Badge variant="secondary">{t('autoUpstream')}</Badge>
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

// Wraps a disabled control in a Tooltip that explains why it is locked.
// When not locked it renders children unchanged (no extra wrapper semantics).
function DisabledHint({
  locked, hint, children,
}: {
  locked: boolean;
  hint: string;
  children: React.ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return (
    <Tooltip>
      {/* span wrapper: disabled triggers don't emit pointer events on their own */}
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-lg focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
