import * as React from "react"

import { cn } from "@/lib/utils"

const BASE_CLASS =
  "flex w-full rounded-lg border border-input bg-md-surface-container-high/60 px-3.5 py-2.5 text-base text-foreground transition-[color,box-shadow,background-color] duration-150 ease-[var(--ease-standard)] outline-none placeholder:text-muted-foreground hover:bg-md-surface-container-high hover:border-md-outline focus-visible:border-md-primary focus-visible:ring-2 focus-visible:ring-md-primary/40 focus-visible:bg-md-surface-container-high disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-md-error aria-invalid:ring-2 aria-invalid:ring-md-error/30 md:text-sm"

type NativeTextareaProps = React.ComponentProps<"textarea">

interface TextareaProps extends NativeTextareaProps {
  /** Helper/supporting text rendered below the field. Replaced by errorText when in error. */
  helperText?: React.ReactNode
  /** Error message. When set, the field is marked invalid and the text is announced. */
  errorText?: React.ReactNode
  /** Force the invalid (error) visual + aria-invalid state even without an errorText string. */
  invalid?: boolean
  /** Show a right-aligned character counter (current/max) in the supporting row. */
  showCount?: boolean
  /** Optional submit handler. When provided, ⌘/Ctrl+Enter triggers it. No-ops while busy/disabled. */
  onSubmit?: () => void
  /** Optional hint shown in the supporting row when onSubmit is provided (e.g. "Press ⌘+Enter to send"). */
  submitHint?: React.ReactNode
  /** Lower bound for auto-grow height (in text rows). Defaults to native `rows` or 3. */
  minRows?: number
  /** Upper bound for auto-grow height (in text rows); content beyond this scrolls. */
  maxRows?: number
  /**
   * Manual resize affordance. When undefined (default) the field auto-grows with content
   * (field-sizing-content). Set `resizable={false}` to lock height, or `true` to allow vertical drag.
   */
  resizable?: boolean
  /** Reflects an in-flight async state: sets aria-busy and disables ⌘/Ctrl+Enter submit. */
  busy?: boolean
}

function Textarea({
  className,
  id: idProp,
  helperText,
  errorText,
  invalid,
  showCount,
  maxLength,
  onSubmit,
  submitHint,
  minRows,
  maxRows,
  resizable,
  busy,
  required,
  disabled,
  rows,
  value,
  defaultValue,
  onChange,
  onKeyDown,
  style,
  "aria-describedby": ariaDescribedByProp,
  ...props
}: TextareaProps) {
  const reactId = React.useId()
  const id = idProp ?? `textarea-${reactId}`
  const supportId = `${id}-support`

  const isError = invalid || !!errorText

  // Track character count for both controlled and uncontrolled usage.
  const initialCount = React.useMemo(() => {
    const v = value ?? defaultValue
    return typeof v === "string" ? v.length : Array.isArray(v) ? v.join("").length : 0
  }, [value, defaultValue])
  const [internalCount, setInternalCount] = React.useState(initialCount)
  const count = typeof value === "string" ? value.length : internalCount

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInternalCount(e.target.value.length)
    onChange?.(e)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e)
    if (
      onSubmit &&
      !busy &&
      !disabled &&
      e.key === "Enter" &&
      (e.metaKey || e.ctrlKey) &&
      !e.defaultPrevented
    ) {
      e.preventDefault()
      onSubmit()
    }
  }

  // Counter color: turn error when at/over limit or within last 10% (min 10 chars) of the cap.
  const overLimit = typeof maxLength === "number" && count > maxLength
  const nearLimit =
    typeof maxLength === "number" &&
    !overLimit &&
    count >= maxLength - Math.max(10, Math.floor(maxLength * 0.1))

  // Sizing model.
  const effectiveResizable = resizable
  const sizingClass =
    effectiveResizable === undefined
      ? "field-sizing-content resize-none"
      : effectiveResizable
        ? "resize-y"
        : "resize-none"
  const minRowsValue = minRows ?? rows ?? 3
  const minHeightClass = minRows === undefined && rows === undefined ? "min-h-20" : undefined
  const sizingStyle: React.CSSProperties = {}
  if (minRows !== undefined || maxRows !== undefined) {
    // Approximate line box: 1.5em line-height + vertical padding (0.625rem * 2 = 1.25rem).
    if (minRows !== undefined) sizingStyle.minHeight = `calc(${minRows} * 1.5em + 1.25rem)`
    if (maxRows !== undefined) {
      sizingStyle.maxHeight = `calc(${maxRows} * 1.5em + 1.25rem)`
      sizingStyle.overflowY = "auto"
    }
  }

  const showSupport = !!helperText || !!errorText || showCount || !!submitHint
  const describedBy =
    [ariaDescribedByProp, showSupport ? supportId : undefined].filter(Boolean).join(" ") || undefined

  const textareaEl = (
    <textarea
      id={id}
      data-slot="textarea"
      rows={minRows === undefined ? rows : minRowsValue}
      value={value}
      defaultValue={defaultValue}
      maxLength={maxLength}
      required={required}
      aria-required={required || undefined}
      disabled={disabled}
      aria-invalid={isError || undefined}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      style={Object.keys(sizingStyle).length ? { ...sizingStyle, ...style } : style}
      className={cn(BASE_CLASS, sizingClass, minHeightClass, className)}
      {...props}
    />
  )

  // Backward-compat: with no new affordances, render the bare textarea (no wrapper).
  if (!showSupport) {
    return textareaEl
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      {textareaEl}
      <div className="flex items-start gap-3 px-0.5 text-xs">
        <div
          id={supportId}
          className={cn(
            "min-w-0 flex-1 leading-snug",
            isError ? "text-md-error" : "text-muted-foreground"
          )}
          role={errorText ? "alert" : undefined}
        >
          {errorText ? errorText : helperText}
          {!errorText && !helperText && submitHint ? (
            <span className="text-muted-foreground">{submitHint}</span>
          ) : null}
          {(errorText || helperText) && submitHint ? (
            <span className="ml-2 text-muted-foreground">{submitHint}</span>
          ) : null}
        </div>
        {showCount ? (
          <span
            className={cn(
              "shrink-0 tabular-nums font-500",
              overLimit || nearLimit ? "text-md-error" : "text-muted-foreground"
            )}
          >
            {count}
            {typeof maxLength === "number" ? `/${maxLength}` : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export { Textarea }
export type { TextareaProps }
