import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// M3 chip: pill shape, tonal container fills, on-container labels. Interactive
// (`a&`) chips get a subtle state-layer-style hover via the same tonal family.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-500 whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:ring-2 aria-invalid:ring-md-error/40 [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        // info / neutral brand accent — primary tonal container
        default:
          "bg-md-primary-container text-md-on-primary-container [a&]:hover:bg-md-primary-container/80",
        // lower-emphasis neutral chip — secondary tonal container
        secondary:
          "bg-md-secondary-container text-md-on-secondary-container [a&]:hover:bg-md-secondary-container/80",
        // error / destructive — error tonal container
        destructive:
          "bg-md-error-container text-md-on-error-container focus-visible:ring-md-error/40 [a&]:hover:bg-md-error-container/80",
        // success — tertiary (teal-green) tonal container (§10 success recipe)
        success:
          "bg-md-tertiary-container text-md-on-tertiary-container [a&]:hover:bg-md-tertiary-container/80",
        // warning — amber chip, light & dark safe (DESIGN_SYSTEM §10 sanctioned recipe).
        // The only place this amber tone lives, so dark-mode tuning is centralized here.
        warning:
          "bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:bg-[hsl(43_96%_50%/0.18)] dark:text-[hsl(43_96%_70%)] [a&]:hover:bg-[hsl(43_96%_50%/0.25)] dark:[a&]:hover:bg-[hsl(43_96%_50%/0.28)]",
        // info / neutral — primary tonal container (semantic alias of `default`)
        info:
          "bg-md-primary-container text-md-on-primary-container [a&]:hover:bg-md-primary-container/80",
        // outlined assist chip — transparent fill, M3 outline
        outline:
          "border-md-outline-variant text-md-on-surface-variant [a&]:hover:bg-md-on-surface/8 [a&]:hover:text-md-on-surface",
        // bare label — no fill until interacted with
        ghost:
          "text-md-on-surface-variant [a&]:hover:bg-md-on-surface/8 [a&]:hover:text-md-on-surface",
        // inline link chip
        link: "text-md-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
