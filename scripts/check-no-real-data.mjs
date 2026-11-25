#!/usr/bin/env node
/**
 * Guard against committing real financial data to this PUBLIC repo (CLAUDE.md non-negotiable #1).
 *
 *   node scripts/check-no-real-data.mjs           checks staged files (pre-commit hook)
 *   node scripts/check-no-real-data.mjs --all     checks every tracked file (CI)
 *
 * Fails if:
 *  - a *.pdf outside fixtures/cgd/ is present, or any spreadsheet (*.xls, *.xlsx)
 *  - a *.csv outside fixtures/ is present (transactions belong in the private data repo)
 *  - a text file contains an IBAN-like number: a 25-character Portuguese IBAN (PT + 23 digits, e.g.
 *    "PT50" then 21 digits in groups of four), a bare run of 21+ digits (NIB / IBAN without spaces), or 21+
 *    digits printed in groups of four
 */
import { execFileSync } from 'node:child_process';

const all = process.argv.includes('--all');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const files = (
  all ? git('ls-files', '-z') : git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
)
  .split('\0')
  .filter(Boolean);

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i;
const IBAN_LIKE = [/PT\d{2}(?:\s?\d){21}/gi, /(?<!\d)\d{21,}(?!\d)/g, /(?<!\d)(?:\d{4} ){5}\d{1,4}(?!\d)/g];

const problems = [];
for (const f of files) {
  if (/\.pdf$/i.test(f) && !/^fixtures\/cgd\/[^/]+\.pdf$/.test(f))
    problems.push(`${f}: PDF outside fixtures/cgd/`);
  if (/\.xlsx?$/i.test(f)) problems.push(`${f}: spreadsheet files are not allowed`);
  if (/\.csv$/i.test(f) && !f.startsWith('fixtures/'))
    problems.push(`${f}: CSV outside fixtures/ (real data goes in the private data repo)`);
  if (BINARY.test(f) || f === 'package-lock.json') continue;
  let text;
  try {
    text = all ? git('show', `HEAD:${f}`) : git('show', `:${f}`);
  } catch {
    continue;
  }
  for (const re of IBAN_LIKE) {
    const m = text.match(re);
    if (m) {
      problems.push(`${f}: contains an IBAN-like number (${m[0].slice(0, 4)}…)`);
      break;
    }
  }
}

if (problems.length) {
  console.error('Refusing: this repo is public and must not contain real financial data.\n');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nMove real data to the private data repo. Fixtures must stay synthetic.');
  process.exit(1);
}
console.log(`check-no-real-data: ${files.length} file(s) OK`);
