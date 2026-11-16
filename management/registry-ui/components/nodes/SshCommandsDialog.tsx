import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { model_Node } from '@/src/generated/client';
import { apiPath } from '@/lib/openapi-session';
import { useClipboard } from '@/lib/use-clipboard';
import { buildSshCommands, type SshCommandKind } from '@/lib/ssh-commands';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, Copy, Terminal } from 'lucide-react';

const KIND_LABEL_KEY: Record<SshCommandKind, 'sshTailscale' | 'sshEasytier' | 'sshFrp'> = {
  tailscale: 'sshTailscale',
  easytier: 'sshEasytier',
  frp: 'sshFrp',
};

function CommandRow({ label, command }: { label: string; command: string }) {
  const t = useTranslations('nodes');
  const { copied, copy } = useClipboard();
  return (
    <div className="flex items-center gap-2 rounded-lg bg-md-surface-container-high/60 px-3 py-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="shrink-0 gap-1"
        onClick={() => void copy(command)}
        aria-label={`${t('sshCopy')} ${command}`}
      >
        {copied ? <Check className="size-3.5 text-md-tertiary" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
        {copied ? t('sshCopied') : t('sshCopy')}
      </Button>
    </div>
  );
}

/**
 * Shows copy-paste SSH commands for one or more nodes. The panel never opens a
 * terminal itself: the operator's own ssh client keeps keys, host verification,
 * and agent policy. FRP commands are included when the registry knows the FRP
 * server address; they work from any network.
 */
export function SshCommandsDialog({
  nodes,
  open,
  onOpenChange,
}: {
  nodes: model_Node[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('nodes');
  const tCommon = useTranslations('common');
  const [frpServerAddr, setFrpServerAddr] = useState('');
  const { copied, copy } = useClipboard();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(apiPath('/admin/ssh-config'), { credentials: 'include' })
      .then(async (res) => (res.ok ? ((await res.json()) as { frp_server_addr?: string }) : null))
      .then((body) => {
        if (!cancelled) setFrpServerAddr(body?.frp_server_addr ?? '');
      })
      .catch(() => {
        // Tailscale/EasyTier commands are still useful without the FRP host.
        if (!cancelled) setFrpServerAddr('');
      });
    return () => { cancelled = true; };
  }, [open]);

  const groups = useMemo(
    () => nodes.map((node) => ({ node, commands: buildSshCommands(node, frpServerAddr) })),
    [nodes, frpServerAddr],
  );
  const allCommands = useMemo(
    () => groups.flatMap((g) => g.commands.map((c) => c.command)).join('\n'),
    [groups],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" description={t('sshHint')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-md-primary" aria-hidden="true" />
            {t('sshTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {groups.map(({ node, commands }) => (
            <section key={node.mac ?? node.hostname ?? 'node'}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <h3 className="text-sm font-600 text-foreground">{node.hostname || node.mac || '—'}</h3>
                {node.hostname && node.mac ? (
                  <span className="font-mono text-xs text-muted-foreground">{node.mac}</span>
                ) : null}
              </div>
              {commands.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('sshNoAddress')}</p>
              ) : (
                <div className="space-y-1.5">
                  {commands.map((c) => (
                    <CommandRow key={c.kind} label={t(KIND_LABEL_KEY[c.kind])} command={c.command} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{tCommon('cancel')}</Button>
          <Button onClick={() => void copy(allCommands)} disabled={!allCommands} className="gap-1.5">
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? t('sshCopiedAll') : t('sshCopyAll')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
