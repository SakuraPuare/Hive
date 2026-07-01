import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type CheckboxSize = "sm" | "md"

// Visual box size per variant. The pointer hit area is always >=48dp
// (see before:size-12 below) regardless of the visual size, so dense
// tables and forms can share one accessible target size.
const sizeBox: Record<CheckboxSize, string> = {
  sm: "size-[18px]", // default, visual unchanged for backward compat
  md: "size-6", // 24dp
}

const sizeIcon: Record<CheckboxSize, string> = {
  sm: "size-3.5",
  md: "size-4",
}

type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  /** Visual box size. Hit area stays >=48dp regardless. Defaults to 'sm' (18dp). */
  size?: CheckboxSize
  /**
   * Convenience accessible label. When provided, the checkbox is wrapped in a
   * <label> together with a text node and associated via aria-labelledby.
   * Omit it for the bare controlled usage (pass aria-label / external label).
   */
  label?: React.ReactNode
  /** Extra class for the wrapping <label> when `label` is provided. */
  labelClassName?: string
}

function CheckboxRoot({
  className,
  size = "sm",
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  ...props
}: Omit<CheckboxProps, "label" | "labelClassName">) {
  // Dev-only nudge: a checkbox with no accessible name is a common a11y trap.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    if (!id && !ariaLabel && !ariaLabelledby) {
      // eslint-disable-next-line no-console
      console.warn(
        "[Checkbox] Rendered without an accessible name. Pass `label`, " +
          "`aria-label`, `aria-labelledby`, or an `id` associated with a <label>."
      )
    }
  }, [id, ariaLabel, ariaLabelledby])

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cn(
        "peer relative shrink-0 rounded-[5px] border-2 border-md-outline bg-transparent outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-standard)]",
        sizeBox[size],
        // Invisible >=48dp pointer hit layer, centered, does not affect layout.
        'before:absolute before:left-1/2 before:top-1/2 before:size-12 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
        "hover:border-md-on-surface",
        "focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "aria-invalid:border-md-error aria-invalid:focus-visible:ring-md-error",
        "data-[state=checked]:border-md-primary data-[state=checked]:bg-md-primary data-[state=checked]:text-md-on-primary",
        "data-[state=indeterminate]:border-md-primary data-[state=indeterminate]:bg-md-primary data-[state=indeterminate]:text-md-on-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group grid place-content-center text-current animate-scale-in"
      >
        {/* Radix sets data-state to 'indeterminate' | 'checked'. Render the
            matching glyph; aria-checked=mixed is handled by Radix. */}
        <MinusIcon
          className={cn(sizeIcon[size], "hidden group-data-[state=indeterminate]:block")}
          strokeWidth={3}
          aria-hidden="true"
        />
        <CheckIcon
          className={cn(sizeIcon[size], "hidden group-data-[state=checked]:block")}
          strokeWidth={3}
          aria-hidden="true"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

function Checkbox({ label, labelClassName, id, ...props }: CheckboxProps) {
  const generatedId = React.useId()

  if (label == null) {
    return <CheckboxRoot id={id} {...props} />
  }

  const checkboxId = id ?? `checkbox-${generatedId}`
  const labelId = `${checkboxId}-label`

  return (
    <label
      htmlFor={checkboxId}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-sm text-md-on-surface select-none",
        props.disabled && "cursor-not-allowed opacity-40",
        labelClassName
      )}
    >
      <CheckboxRoot id={checkboxId} aria-labelledby={labelId} {...props} />
      <span id={labelId}>{label}</span>
    </label>
  )
}

export { Checkbox }
export type { CheckboxProps, CheckboxSize }
