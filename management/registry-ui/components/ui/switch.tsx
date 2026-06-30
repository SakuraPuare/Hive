"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
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
          "pointer-events-none block rounded-full ring-0 transition-transform duration-150 ease-[var(--ease-emphasized)]",
          "group-data-[size=default]/switch:size-3 group-data-[size=sm]/switch:size-2.5",
          "data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-[2px]",
          "data-[state=checked]:bg-md-on-primary data-[state=unchecked]:bg-md-outline"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
