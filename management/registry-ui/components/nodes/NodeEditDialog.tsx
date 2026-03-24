import React, { useState } from 'react';
import { patchNode } from '@/lib/api';
import type { main_Node } from '@/src/generated/client';
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

interface NodeEditDialogProps {
  node: main_Node;
  onSave: () => void;
}

export function NodeEditDialog({ node, onSave }: NodeEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(node.location ?? '');
  const [note, setNote] = useState(node.note ?? '');
  const [tailscaleIp, setTailscaleIp] = useState(node.tailscale_ip ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleOpenChange(v: boolean) {
    if (v) {
      setLocation(node.location ?? '');
      setNote(node.note ?? '');
      setTailscaleIp(node.tailscale_ip ?? '');
      setError('');
    }
    setOpen(v);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await patchNode(node.mac, { location, note, tailscale_ip: tailscaleIp });
      setOpen(false);
      onSave();
    } catch (e: any) {
      setError(e?.error || e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Node</DialogTitle>
          <DialogDescription className="font-mono text-xs">{node.mac}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-location">Location</Label>
            <Input
              id="edit-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Beijing DC-1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-note">Note</Label>
            <Input
              id="edit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tailscale">Tailscale IP</Label>
            <Input
              id="edit-tailscale"
              value={tailscaleIp}
              onChange={(e) => setTailscaleIp(e.target.value)}
              placeholder="pending"
              className="font-mono"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
