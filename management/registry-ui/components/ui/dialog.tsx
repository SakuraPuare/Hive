"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-md-scrim/50 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

const dialogSizes = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
} as const

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = "Close",
  pending = false,
  description,
  size = "lg",
  stickyHeaderFooter = false,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  "aria-describedby": ariaDescribedBy,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Hide/show the persistent X close affordance. */
  showCloseButton?: boolean
  /** Accessible label for the X close button (sr-only). */
  closeLabel?: string
  /**
   * When true the surface is locked: Escape, pointer-down-outside and
   * interact-outside are prevented, and the close button is disabled.
   * Use while an async submit/delete is in flight.
   */
  pending?: boolean
  /**
   * Optional description rendered as a DialogDescription and automatically
   * wired via aria-describedby. When omitted (and no aria-describedby is
   * passed), aria-describedby is explicitly undefined to suppress Radix's
   * missing-description warning.
   */
  description?: React.ReactNode
  /** Max-width scale. Defaults to "lg" (the previous hardcoded width). */
  size?: keyof typeof dialogSizes
  /**
   * Opt-in for tall form dialogs that use the default p-6 padding: pins the
   * DialogHeader to the top and DialogFooter to the bottom while only the body
   * scrolls. Leave false (default) for simple dialogs and for callers that
   * supply their own padding (e.g. p-0 with padded header/footer), where the
   * negative-margin offset would not line up. Reachability is already
   * guaranteed without this — the whole surface scrolls when it overflows.
   */
  stickyHeaderFooter?: boolean
}) {
  const generatedDescId = React.useId()
  const describedBy = description
    ? generatedDescId
    : ariaDescribedBy

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-pending={pending ? "" : undefined}
        aria-describedby={describedBy}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
          onEscapeKeyDown?.(event)
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault()
          onPointerDownOutside?.(event)
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault()
          onInteractOutside?.(event)
        }}
        className={cn(
          "animate-scale-in fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 overflow-y-auto rounded-2xl border bg-popover p-6 text-popover-foreground elevation-3 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          stickyHeaderFooter &&
            "[&>[data-slot=dialog-footer]]:sticky [&>[data-slot=dialog-footer]]:bottom-0 [&>[data-slot=dialog-footer]]:z-10 [&>[data-slot=dialog-footer]]:-mb-6 [&>[data-slot=dialog-footer]]:bg-popover [&>[data-slot=dialog-footer]]:pb-6 [&>[data-slot=dialog-header]]:sticky [&>[data-slot=dialog-header]]:top-0 [&>[data-slot=dialog-header]]:z-10 [&>[data-slot=dialog-header]]:-mt-6 [&>[data-slot=dialog-header]]:bg-popover [&>[data-slot=dialog-header]]:pt-6",
          dialogSizes[size],
          className
        )}
        {...props}
      >
        {description ? (
          <DialogDescription id={generatedDescId}>
            {description}
          </DialogDescription>
        ) : null}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            disabled={pending}
            className="state-layer absolute top-4 right-4 inline-flex size-11 items-center justify-center rounded-full text-md-on-surface-variant transition-colors hover:text-md-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-md-surface disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5"
          >
            <XIcon />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-display text-xl leading-tight font-600 text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
