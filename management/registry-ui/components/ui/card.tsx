import * as React from "react"

import { cn } from "@/lib/utils"

type CardProps = React.ComponentProps<"div"> & {
  /**
   * When true, the card signals it is clickable: it lifts on hover
   * (`hover:elevation-1`), shows a pointer cursor, and lifts when a child
   * receives keyboard focus (`focus-within:elevation-1`). Leave `false`
   * (default) for read-only content cards so hover lift does not imply a
   * false "clickable" affordance. Pair an interactive card with a real
   * `onClick`/`role`/`tabIndex` (or wrap it in a link) on the call site.
   */
  interactive?: boolean
}

function Card({ className, interactive = false, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      data-interactive={interactive ? "" : undefined}
      className={cn(
        "flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground transition-shadow duration-200 ease-[var(--ease-standard)]",
        interactive &&
          "cursor-pointer hover:elevation-1 focus-within:elevation-1",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-display leading-none font-600 tracking-tight", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
