import React, { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';

/**
 * 主题色系统 —— 覆盖 Material Design 常见调色板。
 *
 * `default` 是 globals.css 内联手调的 Google 蓝（无 data 属性时的缺省态);其余
 * 19 个种子色由 scripts/gen-themes.mjs 用 material-color-utilities 预生成到
 * styles/themes.css,选择器 `[data-theme-color="<key>"]`。运行时只把 key 写到
 * <html data-theme-color> 上,整站 --md-* 角色即被覆写换肤,明暗双模都正确。
 *
 * swatch 为各色种子(Material 500 号),仅用于选择器里的圆点预览,不参与真正配色。
 */
export type ThemeColorKey =
  | 'default'
  | 'red'
  | 'pink'
  | 'purple'
  | 'deep-purple'
  | 'indigo'
  | 'blue'
  | 'light-blue'
  | 'cyan'
  | 'teal'
  | 'green'
  | 'light-green'
  | 'lime'
  | 'yellow'
  | 'amber'
  | 'orange'
  | 'deep-orange'
  | 'brown'
  | 'grey'
  | 'blue-grey';

export interface ThemeColorOption {
  key: ThemeColorKey;
  /** i18n 键(theme 命名空间),如 theme.color.blue */
  labelKey: string;
  /** 种子色 hex,用于选择器圆点预览 */
  swatch: string;
}

/** 与 scripts/gen-themes.mjs 的 SEEDS 保持一致(顺序即选择器展示顺序)。 */
export const THEME_COLORS: readonly ThemeColorOption[] = [
  { key: 'default', labelKey: 'color.default', swatch: '#3B6FE4' },
  { key: 'red', labelKey: 'color.red', swatch: '#F44336' },
  { key: 'pink', labelKey: 'color.pink', swatch: '#E91E63' },
  { key: 'purple', labelKey: 'color.purple', swatch: '#9C27B0' },
  { key: 'deep-purple', labelKey: 'color.deepPurple', swatch: '#673AB7' },
  { key: 'indigo', labelKey: 'color.indigo', swatch: '#3F51B5' },
  { key: 'blue', labelKey: 'color.blue', swatch: '#2196F3' },
  { key: 'light-blue', labelKey: 'color.lightBlue', swatch: '#03A9F4' },
  { key: 'cyan', labelKey: 'color.cyan', swatch: '#00BCD4' },
  { key: 'teal', labelKey: 'color.teal', swatch: '#009688' },
  { key: 'green', labelKey: 'color.green', swatch: '#4CAF50' },
  { key: 'light-green', labelKey: 'color.lightGreen', swatch: '#8BC34A' },
  { key: 'lime', labelKey: 'color.lime', swatch: '#CDDC39' },
  { key: 'yellow', labelKey: 'color.yellow', swatch: '#FFEB3B' },
  { key: 'amber', labelKey: 'color.amber', swatch: '#FFC107' },
  { key: 'orange', labelKey: 'color.orange', swatch: '#FF9800' },
  { key: 'deep-orange', labelKey: 'color.deepOrange', swatch: '#FF5722' },
  { key: 'brown', labelKey: 'color.brown', swatch: '#795548' },
  { key: 'grey', labelKey: 'color.grey', swatch: '#9E9E9E' },
  { key: 'blue-grey', labelKey: 'color.blueGrey', swatch: '#607D8B' },
] as const;

export const THEME_COLOR_KEYS: readonly ThemeColorKey[] = THEME_COLORS.map((c) => c.key);
export const DEFAULT_THEME_COLOR: ThemeColorKey = 'default';
/** localStorage key + the blocking script in _document.tsx must agree on this. */
export const THEME_COLOR_STORAGE_KEY = 'hive_theme_color';

function isThemeColor(v: unknown): v is ThemeColorKey {
  return typeof v === 'string' && (THEME_COLOR_KEYS as readonly string[]).includes(v);
}

/** Apply/clear the data attribute. `default` clears it so globals.css wins. */
function applyThemeColor(key: ThemeColorKey) {
  const el = document.documentElement;
  if (key === DEFAULT_THEME_COLOR) el.removeAttribute('data-theme-color');
  else el.setAttribute('data-theme-color', key);
}

const ThemeColorContext = createContext<{
  themeColor: ThemeColorKey;
  setThemeColor: (key: ThemeColorKey) => void;
}>({ themeColor: DEFAULT_THEME_COLOR, setThemeColor: () => {} });

export function ThemeColorProvider({ children }: { children: React.ReactNode }) {
  // SSR/首帧用默认值保证 hydration 一致;mount 后从 localStorage 同步。真正防闪
  // 由 _document.tsx 的阻塞脚本负责(在 React 挂载前就写好 data 属性)。
  const [themeColor, setState] = useState<ThemeColorKey>(DEFAULT_THEME_COLOR);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_COLOR_STORAGE_KEY);
      if (isThemeColor(stored)) setState(stored);
    } catch {
      /* localStorage 不可用时静默降级为默认色 */
    }
  }, []);

  const setThemeColor = useCallback((key: ThemeColorKey) => {
    setState(key);
    applyThemeColor(key);
    try {
      localStorage.setItem(THEME_COLOR_STORAGE_KEY, key);
    } catch {
      /* 忽略写入失败,内存态已更新 */
    }
  }, []);

  const value = useMemo(() => ({ themeColor, setThemeColor }), [themeColor, setThemeColor]);

  return <ThemeColorContext.Provider value={value}>{children}</ThemeColorContext.Provider>;
}

export function useThemeColor() {
  return use(ThemeColorContext);
}
