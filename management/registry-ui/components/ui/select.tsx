"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Touch-target sizing for the trigger + menu items.
 *
 * - `sm`      → 36px (h-9). Dense desktop tables/toolbars only.
 * - `default` → 40px (h-10). Matches <Input> for form parity.
 * - `lg`      → 48px (h-12). Touch-first / primary forms.
 *
 * On a coarse pointer (touch) every size is floored to a ≥48dp hit area via
 * `pointer-coarse:min-h-12`, so the visible control keeps its design height on
 * desktop while staying tappable on mobile.
 *
 * Existing callers pass no `size` and get `default`. Note: `default` is now
 * h-10 (was h-9) and `sm` is h-9 (was h-8), per the Material 3 touch-target
 * audit — a deliberate +4px so selects line up with inputs.
 */
type SelectSize = "sm" | "default" | "lg"

const selectTriggerSizeClasses: Record<SelectSize, string> = {
  sm: "h-9 pointer-coarse:min-h-12",
  default: "h-10 pointer-coarse:min-h-12",
  lg: "h-12",
}

const selectItemSizeClasses: Record<SelectSize, string> = {
  sm: "min-h-9",
  default: "min-h-10 pointer-coarse:min-h-12",
  lg: "min-h-12",
}

/**
 * Lets a `<SelectContent size="lg">` flow its density down to every
 * `<SelectItem>` without each consumer repeating the size. Items may still
 * override with their own `size` prop. Defaults to `default` so untouched
 * call sites are unaffected.
 */
const SelectSizeContext = React.createContext<SelectSize>("default")

/**
 * Powers the optional `searchable` mode on <SelectContent>. The content owns a
 * sticky filter input and publishes the current query plus a tiny match
 * registry here; each <SelectItem> self-filters (CSS-hidden, kept mounted so
 * the selected value still resolves) and reports whether it matched so the
 * content can decide when to show the empty message. `null` means the
 * surrounding content is not searchable, so items render unconditionally.
 */
type SelectSearchContextValue = {
  query: string
  /** Report (or update) whether a given item matches the current query. */
  register: (id: string, matches: boolean) => void
  /** Drop an item from the registry on unmount. */
  unregister: (id: string) => void
}

const SelectSearchContext =
  React.createContext<SelectSearchContextValue | null>(null)

/** Flatten a SelectItem's children to a lowercase string for substring search. */
function nodeToSearchText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeToSearchText).join("")
  if (React.isValidElement(node)) {
    return nodeToSearchText(
      (node.props as { children?: React.ReactNode }).children
    )
  }
  return ""
}

/** Small indeterminate spinner for the trigger's loading affordance. */
function SelectSpinner({ className }: { className?: string }) {
  return (
    <span
      data-slot="select-spinner"
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 rounded-full border-2 border-current/30 border-t-current animate-spin",
        className
      )}
    />
  )
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  loading = false,
  clearable = false,
  onClear,
  clearLabel = "Clear selection",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: SelectSize
  /** Swap the chevron for a spinner and mark the trigger aria-busy. */
  loading?: boolean
  /**
   * Render a small clear (X) control that appears only when a value is
   * selected (CSS-gated on the trigger's `data-placeholder` state). Pair with
   * `onClear` — the audit pattern is `onClear={() => onValueChange('')}`,
   * which removes the need for sentinel `value="all"` options.
   */
  clearable?: boolean
  /** Called when the clear control is activated. */
  onClear?: () => void
  /** Accessible label for the clear control. Override for i18n. */
  clearLabel?: string
}) {
  const handleClear = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onClear?.()
  }
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
      className={cn(
        "group/select-trigger flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3.5 py-2 text-sm whitespace-nowrap transition-[color,box-shadow,background-color] duration-150 ease-[var(--ease-standard)] outline-none hover:bg-md-surface-container-high/50 focus-visible:border-md-primary focus-visible:ring-2 focus-visible:ring-md-primary/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/30 data-[placeholder]:text-muted-foreground *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&[data-state=open]_[data-slot=select-chevron]]:rotate-180 [&_[data-slot=select-chevron]]:transition-transform [&_[data-slot=select-chevron]]:duration-200",
        selectTriggerSizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
      <span className="flex shrink-0 items-center gap-1">
        {clearable && !loading && (
          <span
            data-slot="select-clear"
            role="button"
            tabIndex={-1}
            aria-label={clearLabel}
            onPointerDown={handleClear}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleClear(e)
            }}
            className="pointer-events-auto -mr-1 flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-md-surface-container-highest hover:text-foreground group-data-[placeholder]/select-trigger:hidden"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </span>
        )}
        {loading ? (
          <SelectSpinner />
        ) : (
          <SelectPrimitive.Icon asChild>
            <ChevronDownIcon
              data-slot="select-chevron"
              aria-hidden="true"
              className="size-4 opacity-50"
            />
          </SelectPrimitive.Icon>
        )}
      </span>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  size = "default",
  emptyLabel,
  searchable = false,
  searchPlaceholder = "Search…",
  searchLabel,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  /** Density flowed down to child SelectItems via context. */
  size?: SelectSize
  /**
   * Centered, muted message shown when no SelectItems are rendered (e.g. an
   * async list resolved empty) — or, in `searchable` mode, when the query
   * filters everything out. Pass an i18n string. Omit to keep the prior
   * collapsed-empty behavior.
   */
  emptyLabel?: React.ReactNode
  /**
   * Opt into a sticky filter input pinned to the top of the menu. Child
   * SelectItems self-filter on their text (textValue if set, else children).
   * Untouched call sites (no `searchable`) render exactly as before. For very
   * long, async, or remote-paged lists prefer the Command/location-combobox
   * pattern; this is for in-memory option lists that just need scannability.
   */
  searchable?: boolean
  /** Placeholder for the filter input. Pass an i18n string. */
  searchPlaceholder?: string
  /** Accessible label for the filter input. Defaults to `searchPlaceholder`. */
  searchLabel?: string
}) {
  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  // id → matches-current-query. Lets the content know when to show emptyLabel
  // without re-deriving text from children on every keystroke.
  const matchRef = React.useRef<Map<string, boolean>>(new Map())
  const [matchCount, setMatchCount] = React.useState(0)

  const recomputeMatchCount = React.useCallback(() => {
    let n = 0
    for (const m of matchRef.current.values()) if (m) n++
    setMatchCount(n)
  }, [])

  const register = React.useCallback(
    (id: string, matches: boolean) => {
      matchRef.current.set(id, matches)
      recomputeMatchCount()
    },
    [recomputeMatchCount]
  )
  const unregister = React.useCallback(
    (id: string) => {
      matchRef.current.delete(id)
      recomputeMatchCount()
    },
    [recomputeMatchCount]
  )

  const searchCtx = React.useMemo<SelectSearchContextValue | null>(
    () => (searchable ? { query, register, unregister } : null),
    [searchable, query, register, unregister]
  )

  // Reset the query each time the menu closes so reopening starts clean.
  const handleCloseAutoFocus = React.useCallback(
    (e: Event) => {
      setQuery("")
      props.onCloseAutoFocus?.(e)
    },
    [props]
  )

  // Pull focus into the filter input once the menu has opened. Radix focuses
  // the selected item on open; a rAF lands our focus call after that.
  React.useEffect(() => {
    if (!searchable) return
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [searchable])

  const staticChildrenCount = React.Children.toArray(children).length
  // In searchable mode the items are mounted-but-hidden, so fall back to the
  // live match registry to decide emptiness.
  const isEmpty =
    emptyLabel != null &&
    (searchable
      ? query.length > 0 && matchCount === 0
      : staticChildrenCount === 0)

  const content = (
    <>
      {searchable && (
        <div
          className="sticky top-0 z-10 -mx-1.5 -mt-1.5 mb-1.5 flex items-center gap-2 border-b border-md-outline-variant bg-md-surface-container px-3"
          // The wrapper is not a SelectItem; keep Radix from treating clicks
          // here as a selection/typeahead trigger.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <SearchIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-md-on-surface-variant"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel ?? searchPlaceholder}
            autoComplete="off"
            // Keep the input as the keyboard owner: stop printable keys from
            // reaching Radix's typeahead, but let arrows/Enter/Escape through
            // so item navigation and close still work.
            onKeyDown={(e) => {
              const passthrough =
                e.key === "ArrowDown" ||
                e.key === "ArrowUp" ||
                e.key === "Enter" ||
                e.key === "Escape" ||
                e.key === "Tab"
              if (!passthrough) e.stopPropagation()
            }}
            className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label={clearSearchLabel(searchLabel)}
              tabIndex={-1}
              onClick={() => {
                setQuery("")
                inputRef.current?.focus()
              }}
              className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-md-surface-container-highest hover:text-foreground"
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {isEmpty ? (
        <div
          data-slot="select-empty"
          role="presentation"
          className="flex min-h-12 items-center justify-center px-3 py-4 text-center text-sm text-muted-foreground"
        >
          {emptyLabel}
        </div>
      ) : (
        children
      )}
    </>
  )

  return (
    <SelectSizeContext.Provider value={size}>
      <SelectSearchContext.Provider value={searchCtx}>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            data-slot="select-content"
            className={cn(
              "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-md-outline-variant bg-md-surface-container text-popover-foreground elevation-2 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              position === "popper" &&
                "min-w-[var(--radix-select-trigger-width)] data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
              className
            )}
            position={position}
            align={align}
            {...props}
            onCloseAutoFocus={handleCloseAutoFocus}
          >
            <SelectScrollUpButton />
            <SelectPrimitive.Viewport
              className={cn(
                "p-1.5",
                position === "popper" &&
                  "w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
              )}
            >
              {content}
            </SelectPrimitive.Viewport>
            <SelectScrollDownButton />
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectSearchContext.Provider>
    </SelectSizeContext.Provider>
  )
}

/** Derive the clear-search button label from the (optional) search label. */
function clearSearchLabel(searchLabel?: string) {
  return searchLabel ? `${searchLabel}: clear` : "Clear search"
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2.5 py-1.5 text-xs font-500 text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  size,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  /** Override the density inherited from SelectContent for this row. */
  size?: SelectSize
}) {
  const ctxSize = React.useContext(SelectSizeContext)
  const effectiveSize = size ?? ctxSize
  const search = React.useContext(SelectSearchContext)
  const reactId = React.useId()

  // Text used for the searchable filter: explicit `textValue` wins (it may
  // carry richer keywords than the rendered label), else flatten children.
  const searchText = React.useMemo(() => {
    const raw =
      typeof props.textValue === "string"
        ? props.textValue
        : nodeToSearchText(children)
    return raw.toLowerCase()
  }, [props.textValue, children])

  const query = search?.query ?? ""
  const matches = query.length === 0 || searchText.includes(query.toLowerCase())

  // Keep the content's match registry in sync (searchable mode only).
  const register = search?.register
  const unregister = search?.unregister
  React.useEffect(() => {
    if (!register || !unregister) return
    register(reactId, matches)
    return () => unregister(reactId)
  }, [register, unregister, reactId, matches])

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      // Hidden (not unmounted) so the selected value still resolves its label
      // even while filtered out, and so typeahead/keyboard skip it.
      hidden={search != null && !matches ? true : undefined}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-sm outline-hidden select-none transition-colors duration-150 ease-[var(--ease-standard)] focus:bg-md-secondary-container focus:text-md-on-secondary-container data-[state=checked]:bg-md-secondary-container data-[state=checked]:text-md-on-secondary-container data-[state=checked]:font-500 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        selectItemSizeClasses[effectiveSize],
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-md-on-secondary-container" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1.5 h-px bg-md-outline-variant", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      aria-hidden="true"
      className={cn(
        "flex cursor-default items-center justify-center py-1 pointer-coarse:py-2.5",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      aria-hidden="true"
      className={cn(
        "flex cursor-default items-center justify-center py-1 pointer-coarse:py-2.5",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectSpinner,
  SelectTrigger,
  SelectValue,
}
export type { SelectSize }
