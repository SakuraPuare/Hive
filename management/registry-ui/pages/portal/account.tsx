import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalAuthService, PortalService } from '@/src/generated/client';
import { useCustomer } from '@/lib/portal-auth';
import { useFormat } from '@/lib/format';
import { getErrorMessage } from '@/lib/i18n';
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
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { User, Mail, Calendar, Shield, LifeBuoy, Plus, KeyRound, Pencil } from 'lucide-react';

const MIN_PASSWORD_LEN = 8;
const MAX_NICKNAME_LEN = 40;
const RESEND_COOLDOWN = 60;

/** First 1–2 full code points (CJK keeps two chars, emoji not split across a surrogate pair). */
function initial(nickname?: string, email?: string) {
  const src = (nickname || email || '?').trim();
  return Array.from(src).slice(0, 2).join('').toUpperCase();
}

/**
 * Change-password dialog. The backend exposes no authenticated in-session
 * password change — only the email-code reset flow (forgot-password →
 * reset-password). We drive that flow inline against the signed-in customer's
 * own email: send a code, then submit code + new password.
 *
 * Cooldown state lives at the top of this component and is NOT reset when the
 * dialog closes — the key trick has been removed to prevent bypassing the
 * RESEND_COOLDOWN rate-limit guard.
 */
function ChangePasswordDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}) {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [codeError, setCodeError] = React.useState('');
  const [passwordError, setPasswordError] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  // cooldown and codeSent are intentionally NOT reset on dialog close — see component doc.
  const [cooldown, setCooldown] = React.useState(0);
  const [codeSent, setCodeSent] = React.useState(false);

  // Resend cooldown ticker.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Reset transient form state (code/password/errors) on close via the event
  // handler below — not an effect — so cooldown/codeSent survive reopen and the
  // rate-limit cannot be bypassed.
  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setCode('');
      setPassword('');
      setCodeError('');
      setPasswordError('');
    }
    onOpenChange(next);
  };

  const sendCode = async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    try {
      await PortalAuthService.portalForgotPassword({ requestBody: { email } });
      setCodeSent(true);
      setCooldown(RESEND_COOLDOWN);
      toast.success(t('codeSent'));
    } catch (e) {
      toast.error(getErrorMessage(e, t('sendCodeFailed')));
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim();
    const okCode = /^\d{6}$/.test(trimmedCode);
    const okPassword = password.length >= MIN_PASSWORD_LEN;
    setCodeError(okCode ? '' : t('codeInvalid'));
    setPasswordError(okPassword ? '' : t('passwordTooShort'));
    if (!okCode || !okPassword) return;

    setSubmitting(true);
    try {
      await PortalAuthService.portalResetPassword({
        requestBody: { email, code: trimmedCode, password },
      });
      toast.success(t('passwordChanged'));
      onOpenChange(false);
    } catch (err) {
      toast.error(getErrorMessage(err, t('resetFailedMsg')));
    } finally {
      setSubmitting(false);
    }
  };

  const pending = sending || submitting;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md" pending={pending} closeLabel={tCommon('cancel')}>
        <DialogHeader>
          <DialogTitle>{t('changePassword')}</DialogTitle>
          <DialogDescription>{t('changePasswordDesc')}</DialogDescription>
        </DialogHeader>

        {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
        <form className="space-y-4" noValidate onSubmit={handleSubmit} aria-busy={submitting}>
          {/* Email (read-only — the code is mailed to this address) */}
          <div className="space-y-1.5">
            <Label htmlFor="cp-email" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('email')}
            </Label>
            <Input id="cp-email" type="email" value={email} readOnly disabled autoComplete="email" />
          </div>

          {/* Verify code + send/resend */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="cp-code" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('verifyCode')}
              </Label>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs"
                onClick={sendCode}
                loading={sending}
                disabled={cooldown > 0}
              >
                {cooldown > 0
                  ? t('resendCodeIn', { seconds: cooldown })
                  : codeSent
                    ? t('resendCode')
                    : t('sendCode')}
              </Button>
            </div>
            <Input
              id="cp-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              placeholder={t('codePlaceholder')}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (codeError) setCodeError('');
              }}
              required
              aria-required="true"
              error={codeError || undefined}
              helperText={codeError ? undefined : t('codeHint')}
            />
          </div>

          {/* New password */}
          <div className="space-y-1.5">
            <Label htmlFor="cp-password" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('newPassword')}
            </Label>
            <Input
              id="cp-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
              onBlur={(e) => {
                if (e.target.value && e.target.value.length < MIN_PASSWORD_LEN) {
                  setPasswordError(t('passwordTooShort'));
                }
              }}
              autoComplete="new-password"
              required
              aria-required="true"
              minLength={MIN_PASSWORD_LEN}
              passwordToggleLabel={t('togglePassword')}
              error={passwordError || undefined}
              helperText={passwordError ? undefined : t('passwordHint')}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {submitting ? t('submitting') : t('doReset')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PortalAccountPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const fmt = useFormat();
  const { customer, loading, refresh } = useCustomer();
  const pageRef = React.useRef<HTMLDivElement>(null);
  const [pwOpen, setPwOpen] = React.useState(false);
  const [nicknameOpen, setNicknameOpen] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !customer) {
      router.replace(`/portal/login?returnUrl=${encodeURIComponent(router.asPath)}`);
    }
  }, [loading, customer, router]);

  // Move focus to the page container once data is ready (SR/keyboard orientation).
  React.useEffect(() => {
    if (!loading && customer) pageRef.current?.focus();
  }, [loading, customer]);

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 py-32"
        role="status"
        aria-live="polite"
        aria-label={tCommon('loading')}
      >
        {/* M3 circular progress — primary ring */}
        <div
          aria-hidden="true"
          className="h-10 w-10 rounded-full border-[3px] border-md-primary-container border-t-md-primary animate-spin"
          style={{ animationDuration: '0.9s' }}
        />
        <p className="text-sm text-muted-foreground animate-fade-in">{tCommon('loading')}</p>
      </div>
    );
  }

  // Unauthenticated: the redirect effect handles navigation — render nothing to avoid a spinner flash.
  if (!customer) return null;

  const status = customer.status ?? '';
  const isBanned = status === 'banned';
  const isActive = status === '' || status === 'active' || status === 'normal';
  const createdFormatted = fmt.dateTime(customer.created_at);
  const displayName = customer.nickname || customer.email || '';
  const email = customer.email ?? '';

  return (
    <PageContainer width="narrow" ref={pageRef} tabIndex={-1} className="outline-none" aria-labelledby="account-title">
      {/* ── Page header ── */}
      <PageHeader
        icon={<User />}
        title={t('accountTitle')}
        titleId="account-title"
      />

      {/* ── Profile hero card ── */}
      <div
        className="bg-card border rounded-xl p-6 animate-slide-up"
        style={{ animationDelay: '40ms' }}
      >
        <div className="flex items-center gap-5">
          {/* Avatar — primary-container tonal circle */}
          <div
            role="img"
            aria-label={t('avatarFor', { name: displayName })}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full
              bg-md-primary-container text-md-on-primary-container
              font-display text-2xl font-bold elevation-1 select-none"
          >
            {initial(customer.nickname, customer.email)}
          </div>
          <div className="min-w-0 space-y-0.5">
            {customer.nickname ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="font-display text-xl font-semibold text-foreground truncate">
                  {customer.nickname}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setNicknameOpen(true)}
                  aria-label={t('editNickname')}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <SetNicknameCta t={t} onClick={() => setNicknameOpen(true)} variant="outline" />
            )}
            <p className="text-sm text-muted-foreground truncate">{customer.email}</p>
          </div>
        </div>
      </div>

      {/* ── Account info card ── */}
      <div
        className="bg-card border rounded-xl overflow-hidden animate-slide-up"
        style={{ animationDelay: '80ms' }}
      >
        {/* Section label */}
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('accountInfo')}
          </h2>
        </div>

        <dl className="grid grid-cols-1 gap-px sm:grid-cols-2 bg-border">
          {/* Email */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '120ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Mail aria-hidden="true" className="h-3.5 w-3.5" />
              {t('accountEmail')}
            </dt>
            <dd className="text-sm text-foreground">{customer.email}</dd>
          </div>

          {/* Nickname — display only; edit is handled solely from the hero Pencil button */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '160ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <User aria-hidden="true" className="h-3.5 w-3.5" />
              {t('accountNickname')}
            </dt>
            <dd className="text-sm text-foreground">
              {customer.nickname ? (
                <span className="truncate">{customer.nickname}</span>
              ) : (
                <span className="text-muted-foreground italic">{t('noNicknameSet')}</span>
              )}
            </dd>
          </div>

          {/* Status */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '200ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Shield aria-hidden="true" className="h-3.5 w-3.5" />
              {t('accountStatus')}
            </dt>
            <dd className="space-y-2">
              {isBanned ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                    bg-md-error-container text-md-on-error-container"
                >
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error" />
                  <span className="sr-only">{t('accountStatus')}: </span>
                  {t('statusBanned')}
                </span>
              ) : isActive ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                    bg-md-tertiary-container text-md-on-tertiary-container"
                >
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-md-tertiary" />
                  <span className="sr-only">{t('accountStatus')}: </span>
                  {t('statusActive')}
                </span>
              ) : (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                    bg-muted text-muted-foreground"
                >
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-md-outline" />
                  <span className="sr-only">{t('accountStatus')}: </span>
                  {t('statusUnknown')}
                </span>
              )}
              {isBanned && (
                <Link
                  href="/portal/tickets"
                  className="state-layer inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-xs font-medium text-md-primary
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
                >
                  <LifeBuoy aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('bannedContactSupport')}
                </Link>
              )}
            </dd>
          </div>

          {/* Created at */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '240ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Calendar aria-hidden="true" className="h-3.5 w-3.5" />
              {t('accountCreated')}
            </dt>
            <dd className="text-sm text-foreground">
              {customer.created_at ? (
                <time
                  dateTime={customer.created_at}
                  title={fmt.dateTime(customer.created_at)}
                >
                  {createdFormatted}
                </time>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* ── Security card ── */}
      <div
        className="bg-card border rounded-xl overflow-hidden animate-slide-up"
        style={{ animationDelay: '280ms' }}
      >
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('accountSecurity')}
          </h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-5">
          <div className="min-w-0 space-y-0.5">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <KeyRound aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              {t('changePassword')}
            </p>
            <p className="text-xs text-muted-foreground">{t('changePasswordHint')}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setPwOpen(true)}>
            {t('changePassword')}
          </Button>
        </div>
      </div>

      {/* Dialogs — cooldown state lives inside ChangePasswordDialog and is NOT reset by key */}
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} email={email} />
      <EditNicknameDialog
        key={nicknameOpen ? 'nick-open' : 'nick-closed'}
        open={nicknameOpen}
        onOpenChange={setNicknameOpen}
        currentNickname={customer.nickname ?? ''}
        onSaved={refresh}
      />
    </PageContainer>
  );
}

/** "Set nickname" CTA — opens the edit dialog for customers who haven't set one. */
function SetNicknameCta({
  t,
  onClick,
  variant = 'ghost',
}: {
  t: ReturnType<typeof useTranslations>;
  onClick: () => void;
  variant?: 'ghost' | 'outline';
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onClick}
      className={variant === 'ghost' ? '-ml-2 text-md-primary' : undefined}
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
      {t('setNickname')}
    </Button>
  );
}

/**
 * Edit-nickname dialog. Wired to PATCH /portal/me (PortalService.portalUpdateMe),
 * refreshing the shared customer context on success.
 */
function EditNicknameDialog({
  open,
  onOpenChange,
  currentNickname,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentNickname: string;
  onSaved: () => Promise<void> | void;
}) {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const [nickname, setNickname] = React.useState(currentNickname);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError(t('nicknameRequired'));
      return;
    }
    if (trimmed.length > MAX_NICKNAME_LEN) {
      setError(t('nicknameTooLong', { max: MAX_NICKNAME_LEN }));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await PortalService.portalUpdateMe({ requestBody: { nickname: trimmed } });
      await onSaved();
      toast.success(t('nicknameUpdated'));
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err, t('nicknameUpdateFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent size="sm" pending={saving} closeLabel={tCommon('cancel')}>
        <DialogHeader>
          <DialogTitle>{currentNickname ? t('editNickname') : t('setNickname')}</DialogTitle>
          <DialogDescription>{t('editNicknameDesc')}</DialogDescription>
        </DialogHeader>

        {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API */}
        <form className="space-y-4" noValidate onSubmit={handleSubmit} aria-busy={saving}>
          <div className="space-y-1.5">
            <Label htmlFor="edit-nickname" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('accountNickname')}
            </Label>
            <Input
              id="edit-nickname"
              type="text"
              value={nickname}
              autoFocus
              maxLength={MAX_NICKNAME_LEN}
              autoComplete="nickname"
              aria-required="true"
              error={error || undefined}
              onChange={(e) => {
                setNickname(e.target.value);
                if (error) setError('');
              }}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { if (!saving) onOpenChange(false); }}
              disabled={saving}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={saving} disabled={saving}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
