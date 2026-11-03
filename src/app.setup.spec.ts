import { trustProxySetting } from './app.setup';

describe('TRUST_PROXY — proksi ortida mijoz IP si', () => {
  it("bo'sh — loopback (faqat shu kompyuterdagi proksiga ishoniladi)", () => {
    expect(trustProxySetting(undefined)).toBe('loopback');
    expect(trustProxySetting('  ')).toBe('loopback');
  });

  it("off / false / 0 — o'chiq; son — proksilar soni; boshqasi — o'zi (IP / tarmoqlar)", () => {
    expect(trustProxySetting('off')).toBe(false);
    expect(trustProxySetting('FALSE')).toBe(false);
    expect(trustProxySetting('0')).toBe(false);
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});
