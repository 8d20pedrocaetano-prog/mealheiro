import { describe, expect, it } from 'vitest';
import {
  formatEUR,
  formatMoneyCsv,
  isCsvMoney,
  parseMoney,
  parseUserAmount,
  tryParseMoney,
} from '../../src/core/money';

describe('money', () => {
  it('parses CSV amounts to integer cents', () => {
    expect(parseMoney('-12.34')).toBe(-1234);
    expect(parseMoney('1890.00')).toBe(189000);
    expect(parseMoney('260')).toBe(26000);
    expect(parseMoney('7.9')).toBe(790);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('-0.00')).toBe(0);
    expect(() => parseMoney('12,34')).toThrow();
    expect(() => parseMoney('1.234')).toThrow();
    expect(tryParseMoney('')).toBeNull();
  });

  it('rounds rule bounds the way Decimal comparisons behave', () => {
    expect(parseMoney('7.995', 'floor')).toBe(799);
    expect(parseMoney('7.995', 'ceil')).toBe(800);
    expect(parseMoney('-7.995', 'floor')).toBe(-800);
  });

  it('never sums floats: 0.1 + 0.2 is exact', () => {
    expect(parseMoney('0.10') + parseMoney('0.20')).toBe(parseMoney('0.30'));
  });

  it('formats for CSV', () => {
    expect(formatMoneyCsv(-1234)).toBe('-12.34');
    expect(formatMoneyCsv(5)).toBe('0.05');
    expect(formatMoneyCsv(-5)).toBe('-0.05');
    expect(formatMoneyCsv(123456789)).toBe('1234567.89');
    expect(isCsvMoney('-12.34')).toBe(true);
    expect(isCsvMoney('12.3')).toBe(false);
  });

  it('formats pt-PT for display', () => {
    expect(formatEUR(123456)).toBe('1.234,56 €');
    expect(formatEUR(-1550)).toBe('−15,50 €');
    expect(formatEUR(100000000)).toBe('1.000.000,00 €');
    expect(formatEUR(2500, { plus: true })).toBe('+25,00 €');
    expect(formatEUR(2500, { compact: true })).toBe('25 €');
  });

  it('parses what people type', () => {
    expect(parseUserAmount('12,5')).toBe(1250);
    expect(parseUserAmount('1.234,56')).toBe(123456);
    expect(parseUserAmount('12.50')).toBe(1250);
    expect(parseUserAmount('1.234')).toBe(123400);
    expect(parseUserAmount('-3')).toBe(-300);
    expect(parseUserAmount('abc')).toBeNull();
    expect(parseUserAmount('1,234')).toBeNull();
  });
});
