import { describe, it, expect } from 'vitest';
import { LOCATION_OPTIONS } from '@/lib/locations';

describe('LOCATION_OPTIONS', () => {
  it('is a non-empty array', () => {
    expect(LOCATION_OPTIONS.length).toBeGreaterThan(10);
  });

  it('first option is empty (不设置)', () => {
    expect(LOCATION_OPTIONS[0]).toEqual({ value: '', label: '（不设置）' });
  });

  it('contains China with flag emoji', () => {
    const china = LOCATION_OPTIONS.find((o) => o.value.includes('中国'));
    expect(china).toBeDefined();
    expect(china!.value).toMatch(/🇨🇳/);
  });

  it('contains Japan with flag emoji', () => {
    const jp = LOCATION_OPTIONS.find((o) => o.value.includes('日本'));
    expect(jp).toBeDefined();
    expect(jp!.value).toMatch(/🇯🇵/);
  });

  it('all non-empty options have matching value and label', () => {
    LOCATION_OPTIONS.filter((o) => o.value !== '').forEach((o) => {
      expect(o.value).toBe(o.label);
    });
  });

  it('options after first are sorted by pinyin of the country name', () => {
    // 国旗 emoji 排在名字前面，直接比较 label 会退化成按 emoji/ISO 码排序；
    // 列表必须按国名（中文拼音）排序，否则找国家要靠猜。
    const names = LOCATION_OPTIONS.slice(1).map((o) => o.label.replace(/^\S+\s/, ''));
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    expect(names).toEqual(sorted);
  });

  it('country code options sort by pinyin in zh and alphabetically in en', async () => {
    const { countryCodeOptions } = await import('@/lib/locations');
    for (const [locale, collation] of [['zh', 'zh-CN'], ['en', 'en']] as const) {
      const names = countryCodeOptions(locale).map((o) => o.label.replace(/^\S+\s/, ''));
      const sorted = [...names].sort((a, b) => a.localeCompare(b, collation));
      expect(names).toEqual(sorted);
    }
    const zh = countryCodeOptions('zh').map((o) => o.label);
    expect(zh.find((l) => l.includes('中国'))).toMatch(/^🇨🇳/);
  });
});
