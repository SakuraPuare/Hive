import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "state-layer ripple inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 ease-[var(--ease-standard)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none aria-invalid:ring-2 aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Filled — the single key action. Primary fill + tonal elevation lift.
        default:
          "bg-md-primary text-md-on-primary elevation-1 hover:elevation-2",
        // Filled error — destructive key action.
        destructive:
          "bg-md-error text-md-on-error elevation-1 hover:elevation-2 focus-visible:ring-destructive",
        // Outlined — neutral, low emphasis. Outline-variant hairline, no fill.
        outline:
          "border border-md-outline-variant bg-transparent text-md-on-surface hover:border-md-outline",
        // Tonal — secondary-container, the workhorse secondary action.
        secondary:
          "bg-md-secondary-container text-md-on-secondary-container",
        // Text / ghost — bare, state-layer carries hover.
        ghost: "bg-transparent text-md-on-surface",
        // Link — primary text, underline on hover.
        link: "text-md-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2 has-[>svg]:px-4",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3.5 has-[>svg]:px-3",
        lg: "h-11 px-7 text-base has-[>svg]:px-5",
        icon: "size-10 rounded-full",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-full",
        "icon-lg": "size-11 rounded-full",
        // 48dp — strict WCAG 2.5.8 / M3 touch target.
        "icon-xl": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /**
     * When true, prepends a circular spinner, sets aria-busy, and implicitly
     * disables the button while keeping its label visible (no spinner-only).
     * With asChild the spinner is NOT injected (Slot accepts a single child);
     * only aria-busy is applied so the caller's markup stays intact.
     */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const isDisabled = disabled || loading

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      aria-busy={loading || undefined}
      disabled={asChild ? disabled : isDisabled}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? (
            <Loader2
              className="size-4 shrink-0 animate-spin"
              aria-hidden="true"
            />
          ) : null}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
