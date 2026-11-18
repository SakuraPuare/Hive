import countries from 'i18n-iso-countries';
import zhLocale from 'i18n-iso-countries/langs/zh.json';

countries.registerLocale(zhLocale);

/** ISO-3166-1 alpha-2 → 国旗 emoji */
export function isoToFlag(code: string): string {
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

/** 所有国家/地区，按中文名排序（拼音序；不能按带国旗的 label 排，emoji 会盖过名字） */
export const LOCATION_OPTIONS: LocationOption[] = [
  { value: '', label: '（不设置）' },
  ...Object.entries(countries.getNames('zh', { select: 'official' }))
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map(({ code, name }) => ({
      value: `${isoToFlag(code)} ${name}`,
      label: `${isoToFlag(code)} ${name}`,
    })),
];

/** ISO-3166-1 alpha-2 → 本地化的"🇨🇳 中国" */
export function countryDisplay(code: string | undefined | null, locale = 'zh'): string {
  if (!code) return '';
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return code;
  const name = countries.getName(cc, locale === 'en' ? 'en' : 'zh', { select: 'official' }) || cc;
  return `${isoToFlag(cc)} ${name}`;
}

export interface CountryOption {
  value: string; // ISO-3166-1 alpha-2，如 "CN"
  label: string; // 展示用，如 "🇨🇳 中国"
}

/** 国家代码下拉项（用于位置人工指定），与 location 的展示格式一致 */
export function countryCodeOptions(locale = 'zh'): CountryOption[] {
  const lang = locale === 'en' ? 'en' : 'zh';
  // 中文界面按拼音排，英文界面按字母排；排序键必须是国名而不是带国旗的 label。
  return Object.entries(countries.getNames(lang, { select: 'official' }))
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'zh-CN'))
    .map(({ code }) => ({ value: code, label: countryDisplay(code, locale) }));
}
