import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-md-surface-container-high/60 px-3.5 py-2 text-base text-foreground transition-[color,box-shadow,background-color] duration-150 ease-[var(--ease-standard)] outline-none selection:bg-md-primary selection:text-md-on-primary file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:bg-md-surface-container-high hover:border-md-outline disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-md-primary focus-visible:ring-2 focus-visible:ring-md-primary/40 focus-visible:bg-md-surface-container-high",
        "aria-invalid:border-md-error aria-invalid:ring-2 aria-invalid:ring-md-error/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
