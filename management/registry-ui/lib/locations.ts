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

/** Same country precedence as gateway auto routing; legacy location is display-only. */
export function effectiveCountry(node: { country_override?: string | null; country?: string | null }): string {
  for (const value of [node.country_override, node.country]) {
    const code = value?.trim().toUpperCase() ?? '';
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return '';
}

export function nodeLocation(node: { country_override?: string | null; country?: string | null; location?: string | null }, locale = 'zh'): string {
  return countryDisplay(effectiveCountry(node), locale) || node.location || '';
}
