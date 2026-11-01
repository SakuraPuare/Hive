import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

/**
 * Regression: `DropdownMenuItem` used to inject its loading spinner as a
 * sibling of `children` unconditionally. With `asChild` that handed Radix's
 * item slot (`Primitive.div`) two children — `[null, child]` — so opening any
 * menu holding an `asChild` item threw
 * "Primitive.div failed to slot onto its children" and took the whole app
 * down with a client-side exception.
 */
describe('DropdownMenuItem', () => {
  it('slots a single child when asChild is set', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent forceMount>
          <DropdownMenuItem asChild>
            <a href="/portal/account">Account</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const link = screen.getByRole('menuitem', { name: 'Account' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/portal/account');
  });

  it('still renders the loading spinner for non-asChild items', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent forceMount>
          <DropdownMenuItem loading>Busy</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const item = screen.getByRole('menuitem', { name: 'Busy' });
    expect(item.querySelector('[data-slot="dropdown-menu-spinner"]')).not.toBeNull();
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });
});
