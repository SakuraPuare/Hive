import React, { useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface LocationOption {
  value: string;
  label: string;
}

interface LocationComboboxProps {
  options: LocationOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** id forwarded to the trigger button so an external <Label htmlFor> can associate with it. */
  id?: string;
  /** id of an external label element; wired to the trigger via aria-labelledby. */
  ariaLabelledby?: string;
  /** Accessible name fallback when no visible label is associated. */
  'aria-label'?: string;
  /** Touch target sizing. 'default' meets the M3 48dp minimum; 'sm' is for dense admin lists. */
  size?: 'sm' | 'default';
  /** Show an explicit clear (X) button when a value is selected. Replaces the implicit re-click toggle. */
  clearable?: boolean;
  /** While true, the list shows a loading placeholder and the empty state is suppressed. */
  loading?: boolean;
  /** Disables the trigger and prevents opening. */
  disabled?: boolean;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Message shown when there is data but the query matches nothing. */
  emptyText?: string;
  /** Message shown when the option source is empty (distinct from "no match"). */
  noOptionsText?: string;
  /** Message shown in the loading placeholder row. */
  loadingText?: string;
  /** Accessible label for the clear button (sr-only). */
  clearLabel?: string;
  /** Cap the number of rendered options; remaining are hidden behind a "keep typing" hint. */
  maxRendered?: number;
  /** Hint shown when results are truncated by maxRendered. */
  truncatedText?: string;
}

const SEARCH_DEBOUNCE_MS = 150;

export function LocationCombobox({
  options,
  value,
  onChange,
  placeholder,
  id,
  ariaLabelledby,
  'aria-label': ariaLabel,
  size = 'default',
  clearable = false,
  loading = false,
  disabled = false,
  searchPlaceholder,
  emptyText,
  noOptionsText,
  loadingText,
  clearLabel = 'Clear selection',
  maxRendered,
  truncatedText,
}: LocationComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  // Debounced search value: cmdk filters client-side off this, so debouncing
  // keeps large (~250 item) lists responsive while typing.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const handleSearchChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(next), SEARCH_DEBOUNCE_MS);
  };

  const triggerH = size === 'sm' ? 'min-h-9' : 'min-h-12';
  const itemMinH = size === 'sm' ? '' : 'min-h-12';

  const hasOptions = options.length > 0;

  // Apply an optional render cap. cmdk already filters by the live query, so we
  // truncate the (filtered-by-debounced-query) candidate set for DOM safety.
  const { rendered, truncated } = useMemo(() => {
    if (maxRendered == null || options.length <= maxRendered) {
      return { rendered: options, truncated: false };
    }
    const q = debouncedQuery.trim().toLowerCase();
    const matched = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : options;
    return {
      rendered: matched.slice(0, maxRendered),
      truncated: matched.length > maxRendered,
    };
  }, [options, maxRendered, debouncedQuery]);

  return (
    <div className="relative flex w-full items-center">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return;
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-labelledby={ariaLabelledby}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              'state-layer w-full justify-between rounded-lg font-normal text-foreground',
              triggerH,
              clearable && selected && 'pr-9'
            )}
          >
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? selected.label : (placeholder ?? '')}
            </span>
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-2 h-4 w-4 shrink-0 text-md-on-surface-variant opacity-70"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) overflow-hidden rounded-xl border p-0 elevation-2"
          align="start"
        >
          <Command shouldFilter={maxRendered == null}>
            <CommandInput
              aria-label={ariaLabel ?? searchPlaceholder}
              placeholder={searchPlaceholder ?? ''}
              value={query}
              onValueChange={handleSearchChange}
            />
            <CommandList id={listId} role="listbox">
              {loading ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
                >
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-md-primary" />
                  {loadingText ? <span>{loadingText}</span> : null}
                </div>
              ) : !hasOptions ? (
                <div className="py-8 text-center text-sm text-muted-foreground" role="status">
                  {noOptionsText ?? emptyText ?? ''}
                </div>
              ) : (
                <>
                  <CommandEmpty>{emptyText ?? ''}</CommandEmpty>
                  <CommandGroup>
                    {rendered.map((opt) => (
                      <CommandItem
                        key={opt.value || '__empty__'}
                        value={opt.value || opt.label}
                        keywords={[opt.label]}
                        className={cn('cursor-pointer rounded-lg', itemMinH)}
                        onSelect={() => {
                          onChange(opt.value);
                          setOpen(false);
                        }}
                      >
                        <Check
                          aria-hidden="true"
                          className={cn(
                            'mr-2 h-4 w-4 text-md-primary',
                            value === opt.value ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        {opt.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {truncated && truncatedText ? (
                    <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                      {truncatedText}
                    </div>
                  ) : null}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {clearable && selected && !disabled ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange('')}
          className="state-layer absolute right-1 flex size-7 items-center justify-center rounded-full text-md-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
