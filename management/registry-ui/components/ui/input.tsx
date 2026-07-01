import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Eye, EyeOff, X } from "lucide-react"

import { cn } from "@/lib/utils"

// M3 touch-target compliant sizing. Default `md` = h-12 (48dp). `sm` = h-10,
// opt-in for dense desktop contexts (e.g. data-table search). text-base on
// mobile prevents iOS focus zoom; md:text-sm tightens on >=md viewports.
const inputVariants = cva(
  "w-full min-w-0 rounded-lg border border-input bg-md-surface-container-high/60 text-base text-foreground transition-[color,box-shadow,background-color] duration-150 ease-[var(--ease-standard)] outline-none selection:bg-md-primary selection:text-md-on-primary file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:bg-md-surface-container-high hover:border-md-outline disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-md-primary focus-visible:ring-2 focus-visible:ring-md-primary/40 focus-visible:bg-md-surface-container-high aria-invalid:border-md-error aria-invalid:ring-2 aria-invalid:ring-md-error/30",
  {
    variants: {
      size: {
        md: "h-12 px-3.5 py-2.5",
        sm: "h-10 px-3.5 py-2",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

type NativeInputProps = Omit<React.ComponentProps<"input">, "size">

interface InputProps
  extends NativeInputProps,
    VariantProps<typeof inputVariants> {
  /** Leading adornment (decorative icon, etc.). Auto aria-hidden wrapper. */
  startIcon?: React.ReactNode
  /** Trailing adornment. Overridden by password toggle / clear button slots when those are active. */
  endIcon?: React.ReactNode
  /** Render a focusable clear button when the field has a value. */
  clearable?: boolean
  /** aria-label for the clear button. */
  clearLabel?: string
  /** Validation error message — wires aria-invalid + aria-describedby and renders an assertive error region. */
  error?: string
  /** Non-error helper text — rendered below and wired into aria-describedby. */
  helperText?: string
  /** aria-label for the password show/hide toggle (when type='password'). Static fallback if show/hide variants are not given. */
  passwordToggleLabel?: string
  /** aria-label when the password is hidden (button reveals it). Overrides passwordToggleLabel when set. */
  showPasswordLabel?: string
  /** aria-label when the password is visible (button hides it). Overrides passwordToggleLabel when set. */
  hidePasswordLabel?: string
  /** Debounce onChange / onValueChange by this many ms while keeping the field instantly responsive. */
  debounceMs?: number
  /** Convenience callback receiving the string value (debounced when debounceMs is set). */
  onValueChange?: (value: string) => void
}

function Input({
  className,
  type,
  size,
  startIcon,
  endIcon,
  clearable,
  clearLabel = "Clear",
  error,
  helperText,
  passwordToggleLabel = "Toggle password visibility",
  showPasswordLabel,
  hidePasswordLabel,
  debounceMs,
  onValueChange,
  onChange,
  id: idProp,
  value: valueProp,
  defaultValue,
  disabled,
  "aria-describedby": ariaDescribedByProp,
  "aria-invalid": ariaInvalidProp,
  ...props
}: InputProps) {
  const reactId = React.useId()
  const id = idProp ?? reactId
  const describedById = `${id}-description`

  const inputRef = React.useRef<HTMLInputElement>(null)
  const [showPassword, setShowPassword] = React.useState(false)

  // Debounce plumbing: keep an internal value for instant feedback, fire the
  // user's onChange/onValueChange on a trailing timer.
  const isControlled = valueProp !== undefined
  const [internalValue, setInternalValue] = React.useState<string>(
    () => String(valueProp ?? defaultValue ?? "")
  )
  React.useEffect(() => {
    if (isControlled) setInternalValue(String(valueProp ?? ""))
  }, [isControlled, valueProp])

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const fireChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>, nextValue: string) => {
      onChange?.(event)
      onValueChange?.(nextValue)
    },
    [onChange, onValueChange]
  )

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setInternalValue(nextValue)
    if (debounceMs && debounceMs > 0) {
      if (timerRef.current) clearTimeout(timerRef.current)
      // React pools nothing in 17+, but persist the relevant data.
      const persisted = event
      timerRef.current = setTimeout(() => {
        fireChange(persisted, nextValue)
      }, debounceMs)
    } else {
      fireChange(event, nextValue)
    }
  }

  const emitValue = (nextValue: string) => {
    const el = inputRef.current
    if (!el) return
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set
    nativeSetter?.call(el, nextValue)
    const event = new Event("input", { bubbles: true })
    el.dispatchEvent(event)
  }

  const handleClear = () => {
    setInternalValue("")
    if (timerRef.current) clearTimeout(timerRef.current)
    // Dispatch a real input event so both controlled and uncontrolled callers
    // see the cleared value through their normal onChange path. handleChange
    // (bound to onChange) will fire onValueChange too, so we don't call it here.
    emitValue("")
    inputRef.current?.focus()
  }

  const currentValue = debounceMs ? internalValue : (valueProp ?? internalValue)
  const hasValue = String(currentValue ?? "").length > 0

  const isPassword = type === "password"
  const resolvedType = isPassword && showPassword ? "text" : type

  const hasError = Boolean(error)
  const describedBy =
    cn(ariaDescribedByProp, (error || helperText) && describedById) || undefined

  // Decide trailing slot: password toggle and clear button take precedence over endIcon.
  const showClear = Boolean(clearable && hasValue && !disabled)
  const trailingSlots: React.ReactNode[] = []
  if (showClear) {
    trailingSlots.push(
      <button
        key="clear"
        type="button"
        tabIndex={0}
        aria-label={clearLabel}
        onClick={handleClear}
        disabled={disabled}
        className="inline-flex size-9 items-center justify-center rounded-full text-md-on-surface-variant transition-colors hover:bg-md-surface-container-highest hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/40"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    )
  }
  if (isPassword) {
    trailingSlots.push(
      <button
        key="password-toggle"
        type="button"
        aria-label={showPassword ? (hidePasswordLabel ?? passwordToggleLabel) : (showPasswordLabel ?? passwordToggleLabel)}
        aria-pressed={showPassword}
        onClick={() => {
          setShowPassword((v) => !v)
          inputRef.current?.focus()
        }}
        disabled={disabled}
        className="inline-flex size-11 items-center justify-center rounded-full text-md-on-surface-variant transition-colors hover:bg-md-surface-container-highest hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/40"
      >
        {showPassword ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    )
  }
  if (!isPassword && endIcon) {
    trailingSlots.push(
      <span
        key="end-icon"
        aria-hidden="true"
        className="inline-flex items-center justify-center text-md-on-surface-variant [&_svg]:size-4"
      >
        {endIcon}
      </span>
    )
  }

  const hasAdornments =
    Boolean(startIcon) || trailingSlots.length > 0
  const wireMessages = Boolean(error || helperText)

  // Padding to clear adornments. start: pl-10; trailing scaled by slot count.
  const adornmentPadding = cn(
    startIcon && "pl-10",
    trailingSlots.length === 1 && "pr-11",
    trailingSlots.length >= 2 && "pr-[5.25rem]"
  )

  const inputEl = (
    <input
      ref={inputRef}
      id={id}
      type={resolvedType}
      data-slot="input"
      disabled={disabled}
      aria-invalid={ariaInvalidProp ?? (hasError || undefined)}
      aria-describedby={describedBy}
      {...(isControlled || debounceMs
        ? { value: currentValue }
        : { defaultValue })}
      onChange={handleChange}
      className={cn(inputVariants({ size }), adornmentPadding, className)}
      {...props}
    />
  )

  // Fast path: no adornments and no messages → render bare input so existing
  // callers relying on className-based layout (e.g. data-table pl-10) are
  // unaffected. Default height is now h-12 unless size='sm' / className override.
  if (!hasAdornments && !wireMessages) {
    return inputEl
  }

  return (
    <div className="w-full">
      <div className="relative w-full">
        {startIcon && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-md-on-surface-variant [&_svg]:size-4"
          >
            {startIcon}
          </span>
        )}
        {inputEl}
        {trailingSlots.length > 0 && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5">
            {trailingSlots}
          </div>
        )}
      </div>
      {wireMessages && (
        <p
          id={describedById}
          role={hasError ? "alert" : undefined}
          aria-live={hasError ? "assertive" : undefined}
          className={cn(
            "mt-1.5 text-sm",
            hasError ? "text-md-error" : "text-md-on-surface-variant"
          )}
        >
          {error ?? helperText}
        </p>
      )}
    </div>
  )
}

export { Input, inputVariants }
export type { InputProps }
