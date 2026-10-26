import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function customerSubscriptionToken(value: string): string {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed).pathname.match(/\/c\/([a-f0-9]{64})(?:\/vless)?\/?$/)?.[1] ?? '';
  } catch { return ''; }
}

export function CustomerSubscriptionInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const t = useTranslations('common');
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <Label htmlFor={id}>{t('customerSubscription')}</Label>
      <Input id={id} value={value} onChange={e => onChange(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">{t('customerSubscriptionHint')}</p>
    </div>
  );
}
