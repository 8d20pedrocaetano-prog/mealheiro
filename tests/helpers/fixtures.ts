import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { FileMap } from '../../src/core/dataset';

export const ROOT = join(import.meta.dirname, '..', '..');
export const DEMO_DIR = join(ROOT, 'fixtures', 'demo-data');
export const GOLDEN_DIR = join(ROOT, 'fixtures', 'golden');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The demo data repo as path → text, paths relative to the repo root with forward slashes. */
export function loadDemoFiles(): FileMap {
  const files: FileMap = {};
  for (const p of walk(DEMO_DIR)) {
    if (!/\.(csv|json)$/.test(p)) continue;
    files[relative(DEMO_DIR, p).split(sep).join('/')] = readFileSync(p, 'utf8');
  }
  return files;
}

export function golden(name: string): string {
  return readFileSync(join(GOLDEN_DIR, name), 'utf8');
}
