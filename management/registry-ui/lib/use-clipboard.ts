import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy-to-clipboard with transient "copied" feedback.
 *
 * Six pages hand-rolled `navigator.clipboard.writeText(...).then(...)` with
 * their own `copiedId` timers. This hook centralises the write, the reset
 * timer, and a graceful fallback for insecure/legacy contexts where
 * `navigator.clipboard` is unavailable.
 *
 * `copied` flips true for `resetMs` after a successful copy so callers can show
 * a checkmark without managing their own timeout.
 */
export function useClipboard({ resetMs = 1500 }: { resetMs?: number } = {}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      let ok = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        } else {
          // Fallback for non-secure contexts (http, older browsers).
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        }
      } catch {
        ok = false;
      }
      if (ok) {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      }
      return ok;
    },
    [resetMs],
  );

  return { copied, copy };
}
