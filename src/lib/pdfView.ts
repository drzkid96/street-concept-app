// Render PDF pages to canvases with pdf.js. Shared by Sheets (preview) and Review (markup).
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const store: { pdf: Uint8Array | null; builtAt: string | null } = { pdf: null, builtAt: null };

export async function renderPages(bytes: Uint8Array, host: HTMLElement, width: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pages: HTMLCanvasElement[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const v0 = page.getViewport({ scale: 1 });
    const scale = (width / v0.width) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    c.style.width = '100%'; c.style.height = 'auto';
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
    const wrap = document.createElement('div');
    wrap.className = 'page'; wrap.dataset.page = String(i - 1);
    wrap.appendChild(c);
    host.appendChild(wrap);
    pages.push(c);
  }
  return pages;
}

export function download(bytes: Uint8Array | string, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
