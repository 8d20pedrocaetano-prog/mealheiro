import { describe, expect, it } from 'vitest';
import { isCardIntl, isFxFeeNorm, merchantKey, norm, titleCase } from '../../src/core/normalize';

describe('normalize (DATA_MODEL §5)', () => {
  it('description_norm', () => {
    expect(norm('  COMPRA   Pingo  Doce ')).toBe('PINGO DOCE');
    expect(norm('COMPRAS C.DEB CASTLE EDINBURGH')).toBe('CASTLE EDINBURGH');
    expect(norm('COMPRAR X')).toBe('COMPRAR X');
    expect(norm('Trf Mbway 912XXX001')).toBe('TRF MBWAY 912XXX001');
  });

  it('card_intl and fx_fee', () => {
    expect(isCardIntl('compras c.deb tfl')).toBe(true);
    expect(isCardIntl('COMPRA TFL')).toBe(false);
    expect(isFxFeeNorm(norm('COMISSAO COMPRAS FORA'))).toBe(true);
  });

  it('merchant_key: first two words of A–Z only', () => {
    expect(merchantKey('PINGO DOCE ARE')).toBe('PINGO DOCE');
    expect(merchantKey('BK123 LISBOA')).toBe('BK LISBOA');
    expect(merchantKey('TRF MBWAY 912XXX001')).toBe('TRF MBWAY');
    expect(merchantKey('123 456')).toBe('123 456');
    expect(merchantKey('A.S. ALVERCA')).toBe('A S');
  });

  it('title case like Python str.title()', () => {
    expect(titleCase('PADARIA DO BAI')).toBe('Padaria Do Bai');
    expect(titleCase('BK123ABC')).toBe('Bk123Abc');
    expect(titleCase("O'NEILL S PUB")).toBe("O'Neill S Pub");
    expect(titleCase('CAFÉ ÁGUA')).toBe('Café Água');
    expect(titleCase('WWW.AMAZON.ES')).toBe('Www.Amazon.Es');
  });
});
