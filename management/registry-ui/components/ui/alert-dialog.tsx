"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const alertDialogSizes = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
} as const

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-md-scrim/50 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  children,
  pending = false,
  description,
  size = "sm",
  onEscapeKeyDown,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  /**
   * When true the surface is locked: Escape is prevented and the action button
   * (via its own `loading`/`disabled` prop) holds focus while the async
   * confirm resolves. AlertDialog never closes on outside click, so only Esc
   * needs guarding here.
   */
  pending?: boolean
  /**
   * Optional description rendered as an AlertDialogDescription and
   * automatically wired via aria-describedby. Convenience for callers that do
   * not render their own AlertDialogDescription. When omitted, behavior is
   * unchanged and any explicit aria-describedby / hand-written
   * AlertDialogDescription keeps working.
   */
  description?: React.ReactNode
  /** Max-width scale. Defaults to "sm" (confirmation dialogs are compact). */
  size?: keyof typeof alertDialogSizes
}) {
  const generatedDescId = React.useId()
  const describedBy = description ? generatedDescId : ariaDescribedBy

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-pending={pending ? "" : undefined}
        {...(describedBy !== undefined
          ? { "aria-describedby": describedBy }
          : {})}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
          onEscapeKeyDown?.(event)
        }}
        className={cn(
          "animate-scale-in fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 overflow-y-auto rounded-2xl border bg-popover p-6 text-popover-foreground elevation-3 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          alertDialogSizes[size],
          className
        )}
        {...props}
      >
        {description ? (
          <AlertDialogDescription id={generatedDescId}>
            {description}
          </AlertDialogDescription>
        ) : null}
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "font-display text-xl leading-tight font-600 text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  children,
  loading = false,
  destructive = false,
  disabled,
  loadingLabel,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & {
  /** Renders a spinner, sets aria-busy and disables the button while true. */
  loading?: boolean
  /** Uses the error role fill (bg-md-error / text-md-on-error). */
  destructive?: boolean
  /** Accessible label announced while loading (sr-only). Optional. */
  loadingLabel?: string
}) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(
        buttonVariants({ variant: destructive ? "destructive" : "default" }),
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : null}
      {loading && loadingLabel ? (
        <span className="sr-only">{loadingLabel}</span>
      ) : null}
      {children}
    </AlertDialogPrimitive.Action>
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
