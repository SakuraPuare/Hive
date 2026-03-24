import type { StylesConfig } from 'react-select';

export type SelectOption = { value: string; label: string };

// 用项目的 CSS 变量适配夜间模式，与 Input/Button 等组件保持一致
export const reactSelectStyles: StylesConfig<SelectOption> = {
  control: (base, state) => ({
    ...base,
    minHeight: '2.5rem',
    backgroundColor: 'hsl(var(--background))',
    borderColor: state.isFocused ? 'hsl(var(--ring))' : 'hsl(var(--input))',
    boxShadow: state.isFocused ? '0 0 0 2px hsl(var(--ring))' : 'none',
    borderRadius: 'calc(var(--radius) - 2px)',
    '&:hover': { borderColor: 'hsl(var(--input))' },
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'calc(var(--radius) - 2px)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 50,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? 'hsl(var(--primary))'
      : state.isFocused
      ? 'hsl(var(--accent))'
      : 'transparent',
    color: state.isSelected
      ? 'hsl(var(--primary-foreground))'
      : 'hsl(var(--foreground))',
    cursor: 'pointer',
  }),
  singleValue: (base) => ({ ...base, color: 'hsl(var(--foreground))' }),
  input: (base) => ({ ...base, color: 'hsl(var(--foreground))' }),
  placeholder: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))' }),
  indicatorSeparator: (base) => ({
    ...base,
    backgroundColor: 'hsl(var(--border))',
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: 'hsl(var(--muted-foreground))',
    '&:hover': { color: 'hsl(var(--foreground))' },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: 'hsl(var(--muted-foreground))',
    '&:hover': { color: 'hsl(var(--foreground))' },
  }),
  noOptionsMessage: (base) => ({
    ...base,
    color: 'hsl(var(--muted-foreground))',
  }),
};
