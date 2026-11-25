/**
 * pdf.js in the browser (CLAUDE.md stack: pdfjs-dist in a Web Worker). Parsing and text extraction run in
 * pdf.js's own worker, served from this origin (no CDN); only the positioned text comes back. Loaded
 * lazily, so the app shell doesn't carry pdf.js.
 */
import type { PageItems } from './cgd';
import { ImportError } from './statement';

export async function pdfPages(data: ArrayBuffer): Promise<PageItems[]> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const pages: PageItems[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      pages.push(
        tc.items.flatMap((it) =>
          'str' in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }] : [],
        ),
      );
    }
    return pages;
  } catch (e) {
    if (e instanceof Error && /password/i.test(e.name + e.message)) {
      throw new ImportError('This PDF is password-protected. Export it again without a password.');
    }
    throw new ImportError("Couldn't read this PDF.");
  } finally {
    void task.destroy();
  }
}
