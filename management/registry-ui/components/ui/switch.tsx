"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { Check, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  loading = false,
  showIcon = true,
  onLabel,
  offLabel,
  disabled,
  checked,
  defaultChecked,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
  /** When true: forces disabled, sets aria-busy, and shows a spinner in the thumb. */
  loading?: boolean
  /** M3 thumb icon (check when checked). Defaults to true; set false to suppress. */
  showIcon?: boolean
  /** sr-only status text announced when the switch is on. Falls back to "On". */
  onLabel?: string
  /** sr-only status text announced when the switch is off. Falls back to "Off". */
  offLabel?: string
}) {
  // Derive on/off for the sr-only status text. Controlled `checked` wins;
  // otherwise fall back to `defaultChecked` (best-effort, uncontrolled case).
  const isOn = checked ?? defaultChecked ?? false

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      disabled={disabled || loading}
      checked={checked}
      defaultChecked={defaultChecked}
      aria-busy={loading || undefined}
      className={cn(
        // Transparent ≥48dp hit region via ::before (does not affect flex layout).
        "relative before:absolute before:content-[''] before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-h-[48px] before:min-w-[48px] before:h-full before:w-full",
        "peer group/switch inline-flex shrink-0 items-center rounded-full border-2 outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-standard)]",
        "focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        "data-[state=checked]:border-md-primary data-[state=checked]:bg-md-primary",
        "data-[state=unchecked]:border-md-outline data-[state=unchecked]:bg-md-surface-container-highest",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none flex items-center justify-center rounded-full ring-0 transition-transform duration-150 ease-[var(--ease-emphasized)]",
          "group-data-[size=default]/switch:size-3 group-data-[size=sm]/switch:size-2.5",
          "data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-[2px]",
          "data-[state=checked]:bg-md-on-primary data-[state=unchecked]:bg-md-outline"
        )}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="size-2 animate-spin text-md-primary" />
        ) : showIcon ? (
          <Check
            aria-hidden="true"
            strokeWidth={3}
            className="size-2 text-md-primary opacity-0 transition-opacity duration-150 group-data-[state=checked]/switch:opacity-100"
          />
        ) : null}
      </SwitchPrimitive.Thumb>
      {(onLabel || offLabel) && (
        <span className="sr-only">{isOn ? (onLabel ?? "On") : (offLabel ?? "Off")}</span>
      )}
    </SwitchPrimitive.Root>
  )
}

export { Switch }
