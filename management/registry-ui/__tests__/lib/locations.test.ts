import { describe, it, expect } from 'vitest';
import { countryCodeOptions, nodeLocation } from '@/lib/locations';

describe('node location', () => {
  it.each([
    [{ country_override: ' jp ', country: 'CN', location: '🇨🇳 中国' }, '🇯🇵 日本'],
    [{ country_override: '', country: 'CN', location: '🇯🇵 日本' }, '🇨🇳 中国'],
    [{ country_override: 'unknown', country: ' cn ' }, '🇨🇳 中国'],
    [{ country: 'unknown', location: '北京机房-1' }, '北京机房-1'],
    [{}, ''],
  ])('uses override, then reported country, then legacy location: %j', (node, expected) => {
    expect(nodeLocation(node)).toBe(expected);
  });

  it('localizes the effective country in English', () => {
    expect(nodeLocation({ country_override: 'JP', country: 'CN' }, 'en')).toBe('🇯🇵 Japan');
  });

  it('country code options sort by pinyin in zh and alphabetically in en', () => {
    for (const [locale, collation] of [['zh', 'zh-CN'], ['en', 'en']] as const) {
      const names = countryCodeOptions(locale).map((o) => o.label.replace(/^\S+\s/, ''));
      const sorted = [...names].sort((a, b) => a.localeCompare(b, collation));
      expect(names).toEqual(sorted);
    }
    const zh = countryCodeOptions('zh').map((o) => o.label);
    expect(zh.find((l) => l.includes('中国'))).toMatch(/^🇨🇳/);
  });
});
