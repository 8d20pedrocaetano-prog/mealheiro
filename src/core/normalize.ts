/** Derived fields from DATA_MODEL §5. Mirrors norm / is_card_intl / is_fx_fee / merchant_key in mh.py. */

const PREFIX = /^(COMPRAS C\.DEB|COMPRA)\s+/;

/** Uppercase, whitespace collapsed, trimmed, leading `COMPRAS C.DEB ` / `COMPRA ` removed. */
export function norm(desc: string): string {
  const s = desc.trim().toUpperCase().replace(/\s+/g, ' ');
  return s.replace(PREFIX, '');
}

export function isCardIntl(descriptionRaw: string): boolean {
  return descriptionRaw.toUpperCase().startsWith('COMPRAS C.DEB');
}

export function isFxFeeNorm(descNorm: string): boolean {
  return descNorm.startsWith('COMISSAO COMPRAS FORA');
}

/** First two words after replacing every char outside A–Z and space with a space. */
export function merchantKey(descNorm: string): string {
  const words = descNorm
    .replace(/[^A-Z ]/g, ' ')
    .split(' ')
    .filter((w) => w !== '');
  return words.length ? words.slice(0, 2).join(' ') : descNorm;
}

function isCased(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

/** Python str.title(): first cased letter of every run of cased letters uppercase, the rest lowercase. */
export function titleCase(s: string): string {
  let out = '';
  let prevCased = false;
  for (const ch of s) {
    if (isCased(ch)) {
      out += prevCased ? ch.toLowerCase() : ch.toUpperCase();
      prevCased = true;
    } else {
      out += ch;
      prevCased = false;
    }
  }
  return out;
}
