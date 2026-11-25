/** pdf.js text extraction in Node (legacy build), the same calls the app makes in the browser. */
import { readFileSync } from 'node:fs';
import type { PageItems } from '../../src/import/cgd';

export async function pdfItems(path: string): Promise<{ pages: PageItems[]; bytes: Uint8Array }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(readFileSync(path));
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const pages: PageItems[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    pages.push(
      tc.items.flatMap((it) =>
        'str' in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }] : [],
      ),
    );
  }
  await doc.cleanup();
  await loadingTask.destroy();
  return { pages, bytes };
}
