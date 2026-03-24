import countries from 'i18n-iso-countries';
import zhLocale from 'i18n-iso-countries/langs/zh.json';

countries.registerLocale(zhLocale);

/** ISO-3166-1 alpha-2 → 国旗 emoji */
function isoToFlag(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 0x1f1a5))
    .join('');
}

export interface LocationOption {
  value: string; // 存入 DB 的值，如 "🇨🇳 中国"
  label: string;
}

/** 所有国家/地区，按中文名排序 */
export const LOCATION_OPTIONS: LocationOption[] = [
  { value: '', label: '（不设置）' },
  ...Object.entries(countries.getNames('zh', { select: 'official' }))
    .map(([code, name]) => ({
      value: `${isoToFlag(code)} ${name}`,
      label: `${isoToFlag(code)} ${name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
];
