import { describe, it, expect } from 'vitest';
import { LOCATION_OPTIONS, type LocationOption } from '@/lib/locations';

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

  it('options after first are sorted by Chinese locale', () => {
    const labels = LOCATION_OPTIONS.slice(1).map((o) => o.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    expect(labels).toEqual(sorted);
  });
});
