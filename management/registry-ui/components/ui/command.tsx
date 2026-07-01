import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { Loader2, SearchIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  "aria-label": ariaLabel,
  clearable = false,
  clearLabel = "Clear search",
  value,
  onValueChange,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  /** Render a trailing clear button when there is a value. Requires `onValueChange`. */
  clearable?: boolean
  /** sr-only label for the clear button. */
  clearLabel?: string
}) {
  const showClear =
    clearable && typeof value === "string" && value.length > 0 && !!onValueChange

  return (
    <div
      data-slot="command-input-wrapper"
      className="flex min-h-12 items-center gap-3 border-b border-md-outline-variant px-4"
    >
      <SearchIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-md-on-surface-variant"
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        aria-label={ariaLabel}
        value={value}
        onValueChange={onValueChange}
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
      {showClear ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onValueChange?.("")}
          className="state-layer grid size-9 shrink-0 place-items-center rounded-full text-md-on-surface-variant transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary"
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

function CommandList({
  className,
  loading = false,
  loadingLabel = "Loading…",
  loadingSlot,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List> & {
  /** When true, render the loading slot and suppress CommandEmpty children. */
  loading?: boolean
  /** Accessible/visible label shown next to the default spinner. */
  loadingLabel?: string
  /** Custom loading content; falls back to a spinner + loadingLabel. */
  loadingSlot?: React.ReactNode
}) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[320px] scroll-py-2 overflow-x-hidden overflow-y-auto p-1",
        className
      )}
      {...props}
    >
      {loading ? (
        <CommandPrimitive.Loading>
          {loadingSlot ?? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
            >
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              <span>{loadingLabel}</span>
            </div>
          )}
        </CommandPrimitive.Loading>
      ) : (
        children
      )}
    </CommandPrimitive.List>
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      role="status"
      aria-live="polite"
      className={cn("py-8 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-500 [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 my-1 h-px bg-md-outline-variant", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & {
  /** 'default' = 48dp touch target; 'compact' = 40dp for dense admin lists. */
  size?: "default" | "compact"
}) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      data-size={size}
      className={cn(
        "relative flex cursor-pointer items-center gap-3 rounded-lg px-3 text-sm outline-hidden select-none transition-colors duration-150 ease-[var(--ease-standard)] data-[disabled=true]:pointer-events-none data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50 data-[selected=true]:bg-md-secondary-container data-[selected=true]:text-md-on-secondary-container [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[selected=true]:[&_svg:not([class*='text-'])]:text-md-on-secondary-container",
        size === "compact" ? "min-h-10 py-2" : "min-h-12 py-3",
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      aria-hidden="true"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
