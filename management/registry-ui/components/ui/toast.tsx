import * as React from "react"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Lightweight, dependency-free toast / snackbar system (Material 3 snackbar visuals).
 *
 * Usage:
 *   1. Mount <ToastProvider> once near the app root (already wired in pages/_app.tsx).
 *   2. In any component: const toast = useToast(); toast.success("Saved");
 *
 * The primitive hard-codes no business language: callers pass already-translated
 * messages/actions. Only the close-button aria-label has an English default, which
 * can be overridden via ToastProvider's `closeLabel` prop.
 */

export type ToastVariant = "success" | "error" | "info"

export interface ToastAction {
  /** Visible (already-translated) label for the action button. */
  label: string
  /** Invoked when the action is pressed. The toast is dismissed afterwards. */
  onClick: () => void
}

export interface ToastOptions {
  /** Auto-dismiss delay in ms. Pass 0 (or a falsy value) to disable auto-dismiss. Default 4000. */
  duration?: number
  /** Optional single action (e.g. Undo). */
  action?: ToastAction
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
  variant: ToastVariant
}

export interface ToastApi {
  /** Enqueue a success toast. Returns the toast id. */
  success: (message: string, options?: ToastOptions) => number
  /** Enqueue an error toast (assertive, no auto-dismiss by default). Returns the toast id. */
  error: (message: string, options?: ToastOptions) => number
  /** Enqueue an info toast. Returns the toast id. */
  info: (message: string, options?: ToastOptions) => number
  /** Enqueue a toast with an explicit variant. Returns the toast id. */
  show: (message: string, variant?: ToastVariant, options?: ToastOptions) => number
  /** Dismiss a specific toast by id. */
  dismiss: (id: number) => void
}

const ToastContext = React.createContext<ToastApi | null>(null)

/** Access the toast API. Must be called under a <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>")
  }
  return ctx
}

/**
 * Like {@link useToast} but returns `null` instead of throwing when no
 * <ToastProvider> is mounted. Use this in shared shells/layouts that may render
 * in contexts (tests, isolated stories) without a provider, so a missing toast
 * surface degrades to a no-op rather than crashing the tree.
 */
export function useOptionalToast(): ToastApi | null {
  return React.useContext(ToastContext)
}

export interface ToastProviderProps {
  children: React.ReactNode
  /**
   * aria-label for the region wrapping all toasts. English default; pass a
   * translated string for full localization. Default: "Notifications".
   */
  regionLabel?: string
  /**
   * aria-label for each toast's close button. English default; pass a
   * translated string for full localization. Default: "Dismiss".
   */
  closeLabel?: string
  /** Placement of the toast stack. Default "bottom-center". */
  position?: "bottom-center" | "bottom-right"
  /** Default auto-dismiss delay (ms) for success/info toasts. Default 4000. */
  defaultDuration?: number
  /** Max number of simultaneously visible toasts. Older ones are evicted. Default 4. */
  max?: number
}

const positionClasses: Record<NonNullable<ToastProviderProps["position"]>, string> = {
  "bottom-center": "inset-x-0 bottom-0 items-center sm:items-center",
  "bottom-right": "inset-x-0 bottom-0 items-center sm:items-end sm:right-4 sm:left-auto",
}

let toastSeq = 0

export function ToastProvider({
  children,
  regionLabel = "Notifications",
  closeLabel = "Dismiss",
  position = "bottom-center",
  defaultDuration = 4000,
  max = 4,
}: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  // Track auto-dismiss timers so they can be cleared on manual dismiss / unmount.
  const timers = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const enqueue = React.useCallback(
    (message: string, variant: ToastVariant, options?: ToastOptions): number => {
      const id = ++toastSeq
      // Errors persist by default (duration 0); success/info auto-dismiss.
      const fallbackDuration = variant === "error" ? 0 : defaultDuration
      const duration = options?.duration ?? fallbackDuration
      const item: ToastItem = { id, message, variant, duration, action: options?.action }

      setToasts((prev) => {
        const next = [...prev, item]
        // Evict oldest beyond max (and clear their timers).
        while (next.length > max) {
          const removed = next.shift()
          if (removed) {
            const t = timers.current.get(removed.id)
            if (t) {
              clearTimeout(t)
              timers.current.delete(removed.id)
            }
          }
        }
        return next
      })

      if (duration && duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration)
        timers.current.set(id, timer)
      }
      return id
    },
    [defaultDuration, dismiss, max]
  )

  // Clear any outstanding timers on unmount.
  React.useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => clearTimeout(t))
      map.clear()
    }
  }, [])

  const api = React.useMemo<ToastApi>(
    () => ({
      success: (message, options) => enqueue(message, "success", options),
      error: (message, options) => enqueue(message, "error", options),
      info: (message, options) => enqueue(message, "info", options),
      show: (message, variant = "info", options) => enqueue(message, variant, options),
      dismiss,
    }),
    [enqueue, dismiss]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label={regionLabel}
        className={cn(
          "pointer-events-none fixed z-[100] flex flex-col gap-2 p-4",
          positionClasses[position]
        )}
      >
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDismiss={dismiss} closeLabel={closeLabel} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastRow({
  toast,
  onDismiss,
  closeLabel,
}: {
  toast: ToastItem
  onDismiss: (id: number) => void
  closeLabel: string
}) {
  const isError = toast.variant === "error"
  return (
    <div
      // Errors interrupt (assertive + alert); success/info are polite status.
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 elevation-3",
        "max-w-[min(92vw,28rem)] min-w-[16rem] animate-slide-up",
        "bg-md-inverse-surface text-md-inverse-on-surface",
        // Subtle leading accent so variant is not conveyed by motion/position alone.
        isError && "ring-1 ring-md-error/50"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          toast.variant === "success" && "bg-md-tertiary",
          toast.variant === "error" && "bg-md-error",
          toast.variant === "info" && "bg-md-inverse-primary"
        )}
      />
      <span className="flex-1 text-sm leading-snug">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
          className={cn(
            "state-layer shrink-0 rounded-md px-2 py-1 text-sm font-medium",
            "text-md-inverse-primary",
            "outline-none focus-visible:ring-2 focus-visible:ring-md-inverse-primary"
          )}
        >
          <span>{toast.action.label}</span>
        </button>
      ) : null}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={() => onDismiss(toast.id)}
        className={cn(
          "state-layer shrink-0 rounded-md p-1 text-md-inverse-on-surface/80 hover:text-md-inverse-on-surface",
          "outline-none focus-visible:ring-2 focus-visible:ring-md-inverse-primary"
        )}
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}
