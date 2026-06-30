# Hive Registry UI — Material 3 Design System (Phase 0 foundation)

> Design philosophy in one line: **Google Material 3 / Material You — restrained, clear, layered.** Neutral surfaces carry the page, tonal containers carry content, primary is a disciplined accent, shapes are generously rounded, whitespace is plentiful. Both light and dark are first-class.

This document is the contract for every downstream UI agent. Read it fully before touching a page or primitive. Tokens, classes, and rules here are authoritative.

---

## 1. How the token system is wired

There are **two layers** of color tokens, both defined in `styles/globals.css`:

1. **M3 role tokens** (`--md-*`) — the source of truth. Defined as `H S% L%` HSL triplets in `:root` (light) and `.dark` (dark). These follow the Material 3 color role spec.
2. **shadcn alias tokens** (`--background`, `--card`, `--primary`, ...) — thin aliases that `var()`-reference an M3 role. They exist so the 27 legacy pages and 22 primitives keep working unchanged. **Do not delete them.**

Both layers are exposed to Tailwind via `@theme` as `--color-*`, consumed through `hsl(var(--xxx))`. So:

- `bg-card`, `text-muted-foreground`, `border-input` etc. → still work, now backed by M3 roles.
- `bg-md-primary`, `text-md-on-surface-variant`, `bg-md-surface-container-high` etc. → new, preferred for net-new primitives.

Color opacity modifiers work on both: `bg-md-primary/10`, `text-foreground/60`.

---

## 2. M3 role token reference

Seed: **Google Blue** (`hsl(224 71% 45%)` light). Tertiary uses Google teal-green for a warm secondary layer. Error uses Google red.

### Primary / Secondary / Tertiary / Error
Each comes as a 4-tuple: the accent, its on-color, the container, and the on-container.

| Token | Meaning / when to use |
|---|---|
| `--md-primary` / `bg-md-primary` | Main brand accent. FAB, primary button fill, active nav indicator, key icons. Use sparingly. |
| `--md-on-primary` | Text/icons on a primary fill. |
| `--md-primary-container` | Lower-emphasis primary surface: selected chips, tonal buttons, highlighted cards. |
| `--md-on-primary-container` | Text/icons on primary-container. |
| `--md-secondary` + on/container/on-container | Neutral-blue accents, less prominent than primary. Secondary chips, filter pills. |
| `--md-tertiary` + on/container/on-container | Warm contrast layer (teal-green). Use for accents that need to stand apart from primary blue — e.g. a distinct metric category, success-leaning highlights. |
| `--md-error` + on/container/on-container | Error/destructive. Delete actions, validation failures, offline-critical. |

### Neutral surfaces (the backbone)
| Token | When to use |
|---|---|
| `--md-surface` | App background (`bg-background` alias). |
| `--md-surface-dim` / `--md-surface-bright` | Dimmest / brightest surface extremes. Rarely needed directly. |
| `--md-surface-container-lowest` | Lowest tonal container (light: pure white). Insets/wells. |
| `--md-surface-container-low` | **Card background** (`bg-card` alias). Default content card. |
| `--md-surface-container` | **Popover/menu background** (`bg-popover` alias). Dropdowns, popovers. |
| `--md-surface-container-high` | Raised/secondary surfaces (`bg-secondary`, `bg-muted` aliases). Hover wells, input backgrounds, nested panels. |
| `--md-surface-container-highest` | Highest tonal container. Selected rows, emphasized wells. |
| `--md-on-surface` | Primary text (`text-foreground`). |
| `--md-on-surface-variant` | Secondary/muted text, icons (`text-muted-foreground`). |
| `--md-outline` | Strong borders, dividers needing emphasis. |
| `--md-outline-variant` | Default subtle border (`border`, `border-input` aliases). |
| `--md-inverse-surface` / `--md-inverse-on-surface` | Inverse pair — tooltips, snackbars. |
| `--md-inverse-primary` | Primary tone on inverse surfaces. |
| `--md-scrim` | Modal/dialog backdrop (use with opacity, e.g. `bg-md-scrim/50`). |
| `--md-shadow` | Shadow color (consumed by elevation utilities; not used directly). |

---

## 3. shadcn alias → M3 role map

This is what each legacy class **now means**. Page agents: use this to reason about existing className.

| shadcn alias (className) | → M3 role |
|---|---|
| `bg-background` / `text-background` | `--md-surface` |
| `text-foreground` | `--md-on-surface` |
| `bg-card` | `--md-surface-container-low` |
| `text-card-foreground` | `--md-on-surface` |
| `bg-popover` | `--md-surface-container` |
| `text-popover-foreground` | `--md-on-surface` |
| `bg-primary` / `ring-ring` | `--md-primary` |
| `text-primary-foreground` | `--md-on-primary` |
| `bg-secondary` | `--md-surface-container-high` |
| `text-secondary-foreground` | `--md-on-surface` |
| `bg-muted` | `--md-surface-container-high` |
| `text-muted-foreground` | `--md-on-surface-variant` |
| `bg-accent` | `--md-secondary-container` |
| `text-accent-foreground` | `--md-on-secondary-container` |
| `bg-destructive` | `--md-error` |
| `text-destructive-foreground` | `--md-on-error` |
| `border` / `border-input` | `--md-outline-variant` |
| `chart-1..5` | primary, tertiary, amber `43 96% 50%`, orange `16 90% 55%`, secondary |

`--radius` is now `0.75rem` (was `0.625rem`). Derived: `rounded-sm = radius-8px`, `rounded-md = radius-4px`, `rounded-lg = radius`, plus new `rounded-xl = radius+8px`, `rounded-2xl = radius+16px`.

<!-- chunk2 placeholder -->

## 4. Typography

Fonts are loaded via `next/font/google` in `pages/_app.tsx` and exposed as CSS variables (offline-safe, no CDN `@import`):

- **Display / headings → Lexend** (`--font-display`, `--font-lexend`). Geometric, confident, Google-grade.
- **Body / UI → Roboto Flex** (`--font-sans`, `--font-roboto-flex`). The Material workhorse.

`body` defaults to `--font-sans`. `h1–h4` and the `.font-display` utility use `--font-display` with `-0.01em` tracking.

### M3 type scale (suggested Tailwind classes)
Apply the role, not raw sizes, where possible. Headings get `.font-display`; body/labels stay sans.

| M3 role | Class recipe |
|---|---|
| Display large | `font-display text-5xl font-700 tracking-tight` |
| Display small / Headline | `font-display text-3xl font-600 tracking-tight` |
| Title large (card header) | `font-display text-xl font-600` |
| Title medium | `font-display text-base font-600` |
| Body large | `text-base font-400 leading-relaxed` |
| Body medium (default) | `text-sm font-400 leading-normal` |
| Label large (buttons) | `text-sm font-500` |
| Label medium / caption | `text-xs font-500 text-muted-foreground` |

Rule: numbers in stat cards use `font-display`. Never go below `text-xs` for UI text.

---

## 5. Shape scale

M3 base radius is `0.75rem`. Use the named utilities, not arbitrary values.

| Element | Radius |
|---|---|
| Chips, badges, small inputs | `rounded-md` (~0.25rem from base) → prefer `rounded-lg` for pill-ish chips, or `rounded-full` for true pills |
| Buttons | `rounded-lg` (0.75rem) |
| Inputs, selects, textareas | `rounded-lg` |
| Cards, panels | `rounded-xl` (1.0rem) |
| Dialogs, sheets, large surfaces | `rounded-2xl` (1.25rem) |
| FAB / icon buttons | `rounded-full` or `rounded-2xl` |
| Avatars, status dots | `rounded-full` |

Bigger container = bigger radius. This is the M3 hierarchy cue.

---

## 6. Elevation

M3 two-layer shadow (key + ambient), tuned separately for light and dark. Use `elevation-1..3`. Dark mode automatically uses deeper shadows.

| Level | Class | Use for |
|---|---|---|
| 0 | (none) | Flat content directly on surface. Default cards prefer a `border` over shadow. |
| 1 | `elevation-1` | Resting cards that need lift, search bars. |
| 2 | `elevation-2` | Menus, dropdowns, popovers, raised buttons on hover. |
| 3 | `elevation-3` | Dialogs, modals, FAB, navigation drawers. |

Guidance: a default card uses `bg-card border rounded-xl` (no shadow) for the flat M3 look; add `elevation-1` only when it must float. Dialogs always `elevation-3`. Don't stack shadow + heavy border on the same element.

---

## 7. Motion

Easing variables (M3): `--ease-standard`, `--ease-standard-decelerate`, `--ease-standard-accelerate`, `--ease-emphasized`, `--ease-emphasized-accelerate`. In Tailwind: `ease-[var(--ease-emphasized)]` or rely on the animation utilities below.

- **Hover / focus / press** → use `state-layer` (see §8). Don't hand-roll opacity changes.
- **Element entrance** → `animate-fade-in` (opacity) or `animate-slide-up` (12px rise + fade, emphasized easing).
- **Popovers / dialogs open** → `animate-scale-in` (subtle 0.96→1 scale).
- **Staggered reveal** (lists, stat grids): apply `animate-slide-up` and set an incremental inline delay per item, e.g. `style={{ animationDelay: `${i * 40}ms` }}`. Cap the stagger so the last item lands within ~300ms.

Durations: micro-interactions 150ms, entrances 300–400ms. Use `var(--ease-emphasized)` for entrances, `var(--ease-standard)` for state changes.

<!-- chunk3 -->

## 8. Interaction: state-layer & ripple

**`state-layer`** — the M3 way to show hover/focus/press. Adds a translucent on-color `::after` overlay that intensifies: hover 8%, focus 10%, press 12%. Tint follows `currentColor`; override with `--state-color`.

```tsx
<button className="state-layer rounded-lg px-4 py-2 text-md-on-primary bg-md-primary">
  <span>Save</span>
</button>
```

The component's real content should sit in child elements (state-layer auto-raises direct children above the overlay).

**`hover-state`** — lighter alternative for rows/list items that manage their own children: applies an `on-surface/8%` background tint on hover only. Use for table rows, command items.

**`ripple`** — pure-CSS press ripple for `overflow-hidden`, positioned elements. Optional polish on top of `state-layer` for buttons/FAB. If it ever looks off, drop it and keep `state-layer` — that alone satisfies M3.

---

## 9. COLOR IRON LAWS (non-negotiable)

1. **No legacy blue/indigo/purple gradients.** The old `gradient-brand` (blue→indigo→purple) is dead. The class still exists but now renders a restrained `primary→tertiary` tonal gradient. Don't introduce new multi-hue "AI" gradients. Prefer flat tonal surfaces.
2. **No raw Tailwind palette for brand/primary.** Banned: `bg-blue-500/10 text-blue-600`, `bg-indigo-*`, `bg-purple-*`, `from-blue-* via-* to-*` as primary styling. Use `bg-md-primary`, `bg-md-primary-container`, `text-md-primary` (define a `text-md-primary` via `text-md-primary` utility — it exists from the theme) instead.
3. **Brand expression goes through the container system.** Emphasis = `*-primary-container` / `*-secondary-container` / `*-tertiary-container` with their on-colors. Solid `primary` fill is reserved for the single most important action per view.
4. **Neutrals do the heavy lifting.** Page = `bg-background`. Content = `bg-card` + `border`. Nested/hover = `surface-container-high`. Resist coloring large areas.
5. **Semantic status colors are allowed but must go through tokens** (see §10) — never a bare `text-green-500`.
6. **Text contrast**: body text `text-foreground`, secondary `text-muted-foreground`. Don't use `text-primary` for long-form text.

---

## 10. Status colors (semantic — light & dark safe)

Use these recipes for state. They read correctly in both themes because they pair a container background with its on-color (or use the error role / chart tones).

| State | Recommended classes |
|---|---|
| **online / success** | text/icon: `text-md-tertiary`; chip: `bg-md-tertiary-container text-md-on-tertiary-container`; dot: `bg-md-tertiary` |
| **offline / error / critical** | text/icon: `text-destructive`; chip: `bg-md-error-container text-md-on-error-container`; dot: `bg-md-error` |
| **warning** | text/icon: `text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]`; chip: `bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]`; dot: `bg-[hsl(43_96%_50%)]` |
| **info / neutral** | text/icon: `text-md-primary`; chip: `bg-md-primary-container text-md-on-primary-container`; dot: `bg-md-primary` |
| **idle / disabled** | `text-muted-foreground`; chip: `bg-muted text-muted-foreground`; dot: `bg-md-outline` |

Note: success deliberately uses **tertiary (teal-green)**, not a raw green, so it stays on-brand. Warning has no M3 role here, so the amber `chart-3` tone is used via arbitrary values — these are the only sanctioned arbitrary colors.

---

## 11. Component retrofit examples (before → after)

### Stat card
Before:
```tsx
<div className="bg-white dark:bg-gray-900 rounded-lg shadow p-6 border border-gray-200">
  <p className="text-gray-500 text-sm">Active nodes</p>
  <p className="text-3xl font-bold text-blue-600">11</p>
</div>
```
After:
```tsx
<div className="bg-card border rounded-xl p-6 animate-slide-up">
  <p className="text-xs font-500 text-muted-foreground uppercase tracking-wide">Active nodes</p>
  <p className="font-display text-3xl font-700 text-foreground mt-2">11</p>
  <span className="inline-flex items-center gap-1.5 mt-3 text-xs text-md-tertiary">
    <span className="size-1.5 rounded-full bg-md-tertiary" /> online
  </span>
</div>
```

### Badge / chip
Before: `<span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">online</span>`
After:
```tsx
<span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
  bg-md-tertiary-container text-md-on-tertiary-container">
  <span className="size-1.5 rounded-full bg-md-tertiary" /> online
</span>
```

### Button (primary)
Before: `<button className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-4 py-2">Save</button>`
After:
```tsx
<button className="state-layer ripple inline-flex items-center justify-center gap-2
  rounded-lg px-5 py-2.5 text-sm font-500
  bg-md-primary text-md-on-primary elevation-1
  transition-shadow hover:elevation-2
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2">
  Save
</button>
```

Tonal (secondary) button: `bg-md-secondary-container text-md-on-secondary-container state-layer rounded-lg` with no shadow.

---

## 12. Quick checklist for page/primitive agents

- [ ] Page bg is `bg-background`; cards are `bg-card border rounded-xl`.
- [ ] No `blue-/indigo-/purple-` palette classes; no multi-hue gradients.
- [ ] Primary used once (the key action); everything else uses containers/neutrals.
- [ ] Status uses §10 recipes (success=tertiary, error=error role).
- [ ] Headings/numbers use `font-display`; body uses default sans.
- [ ] Radius matches §5 (cards `rounded-xl`, dialogs `rounded-2xl`).
- [ ] Interactive elements have `state-layer` (+ optional `ripple`) and a focus ring.
- [ ] Entrances use `animate-slide-up` / `animate-fade-in`, staggered where it's a list.
- [ ] Works in both light and dark (verify with the `.dark` toggle).
