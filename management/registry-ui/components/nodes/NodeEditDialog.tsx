import React, { useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Node, handler_NodeUpdateRequest } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { LocationCombobox } from '@/components/ui/location-combobox';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { LOCATION_OPTIONS } from '@/lib/locations';

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 10000;

const STATUS_DOT: Record<string, string> = {
  active: 'bg-md-tertiary',
  maintenance: 'bg-md-outline',
  retired: 'bg-md-error',
};

/**
 * NodeEditDialog — the single source of truth for editing a node.
 *
 * Previously editing lived only at the bottom of the full-page
 * `/nodes/detail?mac=` view, so the common "tweak a note / weight / status"
 * task forced a whole-page navigation and a scroll to the last card. This
 * dialog is reused by the nodes list (in-place edit) and the detail page,
 * keeping the update/validation/retire-confirm logic in one place.
 */
export function NodeEditDialog({
  node,
  open,
  onOpenChange,
  onSaved,
}: {
  node: model_Node | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save with the freshly fetched node. */
  onSaved?: (updated: model_Node) => void;
}) {
  const t = useTranslations('nodeDetail');
  const tCommon = useTranslations('common');
  const toast = useToast();

  // State initializes directly from `node`. Call sites pass key={node.mac} so a
  // different node remounts this component with fresh initial values — the
  // React-recommended alternative to syncing state in an effect on prop change.
  const [location, setLocation] = useState(node?.location ?? '');
  const [note, setNote] = useState(node?.note ?? '');
  const [enabled, setEnabled] = useState(node?.enabled ?? true);
  const [status, setStatus] = useState(node?.status ?? 'active');
  const [weight, setWeight] = useState(String(node?.weight ?? 100));
  const [region, setRegion] = useState(node?.region ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [weightError, setWeightError] = useState('');
  const [confirmRetire, setConfirmRetire] = useState(false);

  function validateWeight(): number | null {
    const trimmed = weight.trim();
    if (trimmed === '') {
      setWeightError(t('weightRequired'));
      return null;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < WEIGHT_MIN || n > WEIGHT_MAX) {
      setWeightError(t('weightRange'));
      return null;
    }
    setWeightError('');
    return n;
  }

  async function persist(weightValue: number) {
    if (!node?.mac) return;
    setSaving(true);
    setSaveError('');
    try {
      await sessionApi(
        AdminService.nodeUpdate({
          mac: node.mac,
          requestBody: { location, note, enabled, status, weight: weightValue, region } as handler_NodeUpdateRequest,
        }),
      );
      toast.success(t('saved'));
      const updated = await sessionApi(AdminService.nodeGet({ mac: node.mac }));
      onSaved?.(updated);
      onOpenChange(false);
    } catch (e) {
      const msg = getErrorMessage(e, t('updateFailed'));
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (!node?.mac) return;
    const weightValue = validateWeight();
    if (weightValue === null) return;
    // Gate the irreversible non-retired → retired transition behind a confirm.
    if (status === 'retired' && node.status !== 'retired') {
      setConfirmRetire(true);
      return;
    }
    void persist(weightValue);
  }

  async function handleConfirmRetire() {
    const weightValue = validateWeight();
    if (weightValue === null) {
      setConfirmRetire(false);
      return;
    }
    await persist(weightValue);
    setConfirmRetire(false);
  }

  const title = node?.note || node?.hostname || node?.mac || '';

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
        <DialogContent
          description={t('editNodeDescription')}
          className="rounded-2xl bg-md-surface-container-low border elevation-3 sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600 text-foreground truncate">
              {t('editNode')}{title ? ` · ${title}` : ''}
            </DialogTitle>
          </DialogHeader>
          <form
            id="node-edit-form"
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
            className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="node-edit-location" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('location')}</Label>
              <LocationCombobox
                id="node-edit-location"
                options={LOCATION_OPTIONS}
                value={location}
                onChange={setLocation}
                placeholder={t('locationPlaceholder')}
                searchPlaceholder={tCommon('search')}
                emptyText={tCommon('noResults')}
                clearable
                clearLabel={tCommon('clear')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="node-edit-region" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('region')}</Label>
              <Input id="node-edit-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t('regionPlaceholder')} helperText={t('regionHelper')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="node-edit-note" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('note')}</Label>
              <Textarea
                id="node-edit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('notePlaceholder')}
                minRows={2}
                maxRows={5}
              />
            </div>
            <div className="space-y-1.5">
              <Label id="node-edit-status-label" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('nodeStatus')}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger aria-labelledby="node-edit-status-label">
                  <span className="flex items-center gap-2">
                    <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[status] ?? 'bg-md-outline'}`} aria-hidden="true" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-md-tertiary" aria-hidden="true" />{t('statusActive')}</span></SelectItem>
                  <SelectItem value="maintenance"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-md-outline" aria-hidden="true" />{t('statusMaintenance')}</span></SelectItem>
                  <SelectItem value="retired"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-md-error" aria-hidden="true" />{t('statusRetired')}</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="node-edit-weight" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('weight')}</Label>
              <Input
                id="node-edit-weight"
                type="number"
                inputMode="numeric"
                min={WEIGHT_MIN}
                max={WEIGHT_MAX}
                step={1}
                value={weight}
                onChange={(e) => { setWeight(e.target.value); if (weightError) setWeightError(''); }}
                onBlur={() => { if (weight.trim() !== '') validateWeight(); }}
                error={weightError || undefined}
                helperText={weightError ? undefined : t('weightHelper')}
              />
            </div>
            <div className="flex items-center gap-3 py-1 sm:col-span-2">
              <Switch
                id="node-edit-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                onLabel={t('enabledOn')}
                offLabel={t('enabledOff')}
              />
              <Label htmlFor="node-edit-enabled" className="cursor-pointer text-sm font-500 text-foreground">{t('enabled')}</Label>
            </div>
            {saveError && (
              <div role="alert" aria-live="assertive" className="sm:col-span-2 flex items-center gap-2 rounded-lg bg-md-error-container px-3 py-2.5 text-sm text-md-on-error-container">
                <span className="size-1.5 rounded-full bg-md-error shrink-0" aria-hidden="true" />
                {saveError}
              </div>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{tCommon('cancel')}</Button>
            <Button type="submit" form="node-edit-form" loading={saving}>{t('saveChanges')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRetire} onOpenChange={(o) => { if (!saving) setConfirmRetire(o); }}>
        <AlertDialogContent pending={saving}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('retireTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('retireDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={saving}
              loadingLabel={tCommon('saving')}
              onClick={(e) => { e.preventDefault(); void handleConfirmRetire(); }}
            >
              {t('retireConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
