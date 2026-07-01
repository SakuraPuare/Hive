import * as React from "react"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Touch-target sizing for the interactive item family
 * (Item / CheckboxItem / RadioItem / SubTrigger).
 *
 * - `sm`          → dense ~36px rows (legacy desktop density).
 * - `default`     → ≥36px, auto-grows to ≥48dp under a coarse pointer (touch).
 * - `comfortable` → always ≥48dp; the recommended choice for touch-first menus.
 *
 * Existing callers pass no `size` and get `default`, which only *adds* a
 * min-height (and a coarse-pointer bump) on top of the prior `py-2 text-sm`
 * geometry — no visual regression on pointer-fine desktop.
 */
type DropdownMenuItemSize = "sm" | "default" | "comfortable"

const dropdownItemSizeClasses: Record<DropdownMenuItemSize, string> = {
  sm: "min-h-9",
  default: "min-h-9 pointer-coarse:min-h-12 pointer-coarse:py-2.5",
  comfortable: "min-h-12 py-2.5",
}

/** Small indeterminate spinner used for the in-menu pending affordance. */
function DropdownMenuSpinner() {
  return (
    <span
      data-slot="dropdown-menu-spinner"
      aria-hidden="true"
      className="size-4 shrink-0 rounded-full border-2 border-current/30 border-t-current animate-spin"
    />
  )
}

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[9rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-md-outline-variant/60 bg-popover p-1.5 text-popover-foreground elevation-2 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  onSelect,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
  size?: DropdownMenuItemSize
  /**
   * When true, shows a leading spinner, marks the item as disabled
   * (aria/data), and blocks selection so async actions can't be
   * double-fired before the menu reacts.
   */
  loading?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      aria-disabled={disabled || loading || undefined}
      onSelect={
        loading
          ? (event) => event.preventDefault()
          : onSelect
      }
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-hidden select-none transition-colors hover-state focus:bg-md-secondary-container focus:text-md-on-secondary-container data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-md-error-container data-[variant=destructive]:focus:text-md-on-error-container [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-destructive!",
        dropdownItemSizeClasses[size],
        className
      )}
      {...props}
    >
      {loading ? <DropdownMenuSpinner /> : null}
      {children}
    </DropdownMenuPrimitive.Item>
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  size = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  size?: DropdownMenuItemSize
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-lg py-2 pr-2.5 pl-8 text-sm outline-hidden select-none transition-colors hover-state focus:bg-md-secondary-container focus:text-md-on-secondary-container data-[state=checked]:bg-md-secondary-container data-[state=checked]:text-md-on-secondary-container data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        dropdownItemSizeClasses[size],
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  size = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  size?: DropdownMenuItemSize
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-lg py-2 pr-2.5 pl-8 text-sm outline-hidden select-none transition-colors hover-state focus:bg-md-secondary-container focus:text-md-on-secondary-container data-[state=checked]:bg-md-secondary-container data-[state=checked]:text-md-on-secondary-container data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        dropdownItemSizeClasses[size],
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2.5 py-1.5 text-xs font-500 uppercase tracking-wide text-muted-foreground data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1.5 h-px bg-md-outline-variant/60", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

/**
 * Standardized non-interactive state row for an empty or loading menu.
 * Pass `loading` to swap in a spinner and announce via `aria-live`.
 * The user-visible `children` text must be supplied by the caller
 * (i18n stays in the page).
 */
function DropdownMenuEmpty({
  className,
  loading = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { loading?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-empty"
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-9 items-center justify-center gap-2 px-2.5 py-3 text-sm text-muted-foreground select-none",
        className
      )}
      {...props}
    >
      {loading ? <DropdownMenuSpinner /> : null}
      {children}
    </div>
  )
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  size = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
  size?: DropdownMenuItemSize
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-hidden select-none transition-colors hover-state focus:bg-md-secondary-container focus:text-md-on-secondary-container data-[inset]:pl-8 data-[state=open]:bg-md-secondary-container data-[state=open]:text-md-on-secondary-container [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        dropdownItemSizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "z-50 min-w-[9rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-xl border border-md-outline-variant/60 bg-popover p-1.5 text-popover-foreground elevation-2 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuEmpty,
}
export type { DropdownMenuItemSize }
