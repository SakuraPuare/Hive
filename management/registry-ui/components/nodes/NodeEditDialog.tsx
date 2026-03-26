import React, { useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Node, handler_NodeUpdateRequest } from '@/src/generated/client';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LocationCombobox } from '@/components/ui/location-combobox';
import { useTranslations } from 'next-intl';
import { LOCATION_OPTIONS } from '@/lib/locations';

interface NodeEditDialogProps {
  node: model_Node;
  onSave: () => void;
}

export function NodeEditDialog({ node, onSave }: NodeEditDialogProps) {
  const t = useTranslations('nodeDetail');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(node.location ?? '');
  const [note, setNote] = useState(node.note ?? '');
  const [enabled, setEnabled] = useState(node.enabled ?? true);
  const [status, setStatus] = useState(node.status ?? 'active');
  const [tags, setTags] = useState(node.tags ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleOpenChange(v: boolean) {
    if (v) {
      setLocation(node.location ?? '');
      setNote(node.note ?? '');
      setEnabled(node.enabled ?? true);
      setStatus(node.status ?? 'active');
      setTags(node.tags ?? '');
      setError('');
    }
    setOpen(v);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await sessionApi(
        AdminService.nodeUpdate({
          mac: node.mac!,
          requestBody: { location, note, enabled, status, tags } as handler_NodeUpdateRequest,
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('enabled')}</Label>
              <Select value={enabled ? '1' : '0'} onValueChange={(v) => setEnabled(v === '1')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">✓</SelectItem>
                  <SelectItem value="0">✗</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('nodeStatus')}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('statusActive')}</SelectItem>
                  <SelectItem value="maintenance">{t('statusMaintenance')}</SelectItem>
                  <SelectItem value="retired">{t('statusRetired')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tags">{t('tags')}</Label>
            <Input
              id="edit-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('tagsPlaceholder')}
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
