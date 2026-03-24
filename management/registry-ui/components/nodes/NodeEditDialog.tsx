import React, { useState } from 'react';
import { NodesService } from '@/src/generated/client';
import type { main_Node, main_UpdateRequest } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { LocationCombobox } from '@/components/ui/location-combobox';
import { useTranslations } from 'next-intl';
import { LOCATION_OPTIONS } from '@/lib/locations';

interface NodeEditDialogProps {
  node: main_Node;
  onSave: () => void;
}

export function NodeEditDialog({ node, onSave }: NodeEditDialogProps) {
  const t = useTranslations('nodeDetail');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(node.location ?? '');
  const [note, setNote] = useState(node.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleOpenChange(v: boolean) {
    if (v) {
      setLocation(node.location ?? '');
      setNote(node.note ?? '');
      setError('');
    }
    setOpen(v);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await sessionApi(
        NodesService.nodeUpdate({
          mac: node.mac!,
          requestBody: { location, note } as main_UpdateRequest,
        }),
      );
      setOpen(false);
      onSave();
    } catch (e: any) {
      setError(e?.error || e?.message || t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{tCommon('edit')}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editNode')}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{node.mac}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t('location')}</Label>
            <LocationCombobox
              options={LOCATION_OPTIONS}
              value={location}
              onChange={setLocation}
              placeholder={t('locationPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-note">{t('note')}</Label>
            <Input
              id="edit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? tCommon('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
