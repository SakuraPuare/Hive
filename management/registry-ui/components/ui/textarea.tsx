import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-lg border border-input bg-md-surface-container-high/60 px-3.5 py-2.5 text-base text-foreground transition-[color,box-shadow,background-color] duration-150 ease-[var(--ease-standard)] outline-none placeholder:text-muted-foreground hover:bg-md-surface-container-high hover:border-md-outline focus-visible:border-md-primary focus-visible:ring-2 focus-visible:ring-md-primary/40 focus-visible:bg-md-surface-container-high disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-md-error aria-invalid:ring-2 aria-invalid:ring-md-error/30 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
