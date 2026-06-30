import React, { useId, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
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
}

export function LocationCombobox({ options, value, onChange, placeholder }: LocationComboboxProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          className="state-layer w-full justify-between rounded-lg font-normal text-foreground"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : (placeholder ?? '选择...')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-md-on-surface-variant opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id={listId}
        className="w-(--radix-popover-trigger-width) overflow-hidden rounded-xl border p-0 elevation-2"
        align="start"
      >
        <Command>
          <CommandInput placeholder="搜索..." />
          <CommandList>
            <CommandEmpty>无匹配结果</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value || '__empty__'}
                  value={opt.label}
                  className="rounded-lg"
                  onSelect={() => {
                    onChange(opt.value === value ? '' : opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 text-md-primary',
                      value === opt.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
