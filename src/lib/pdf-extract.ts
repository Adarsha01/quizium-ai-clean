// PDF text extraction using pdfjs-dist (browser-only).
// IMPORTANT: pdfjs-dist relies on browser globals (DOMMatrix, etc.) and must
// NEVER be evaluated in the SSR/Worker runtime. We therefore dynamic-import
// it lazily inside the function so the module is only loaded in the browser.

export async function extractPdfText(file: File): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("extractPdfText can only run in the browser");
  }

  const pdfjsLib = await import("pdfjs-dist");
  // @ts-ignore - vite url import
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ");
    text += pageText + "\n\n";
  }
  return text.trim();
}
