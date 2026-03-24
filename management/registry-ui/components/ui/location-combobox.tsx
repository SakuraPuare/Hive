import React, { useState } from 'react';
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
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selected ? selected.label : (placeholder ?? '选择...')}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索..." />
          <CommandList>
            <CommandEmpty>无匹配结果</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value || '__empty__'}
                  value={opt.label}
                  onSelect={() => {
                    onChange(opt.value === value ? '' : opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === opt.value ? 'opacity-100' : 'opacity-0')}
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
