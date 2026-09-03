import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const pdfAssetBaseUrl = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI);

export class PdfPreviewView {
  private pdfUrl?: string;
  private pdfDocument?: PDFDocumentProxy;

  constructor(
    private readonly stage: HTMLElement,
    private readonly container: HTMLElement,
  ) {}

  async render(buffer: ArrayBuffer): Promise<void> {
    this.clear();
    this.pdfUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
    this.pdfDocument = await getDocument({
      data: new Uint8Array(buffer.slice(0)),
      cMapUrl: new URL("cmaps/", pdfAssetBaseUrl).href,
      cMapPacked: true,
    }).promise;

    for (let pageNumber = 1; pageNumber <= this.pdfDocument.numPages; pageNumber += 1) {
      const page = await this.pdfDocument.getPage(pageNumber);
      const naturalViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, this.stage.clientWidth - 64);
      const scale = Math.min(1.5, availableWidth / naturalViewport.width);
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable in this browser.");

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute("aria-label", `PDF page ${pageNumber} of ${this.pdfDocument.numPages}`);
      this.container.append(canvas);

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      }).promise;
    }

    this.container.classList.add("visible");
  }

  clear(): void {
    if (this.pdfUrl) URL.revokeObjectURL(this.pdfUrl);
    this.pdfUrl = undefined;
    void this.pdfDocument?.cleanup();
    this.pdfDocument = undefined;
    this.container.replaceChildren();
    this.container.classList.remove("visible");
  }

  download(filename = "main.pdf"): void {
    if (!this.pdfUrl) return;
    const anchor = document.createElement("a");
    anchor.href = this.pdfUrl;
    anchor.download = filename;
    anchor.click();
  }

  dispose(): void {
    this.clear();
  }
}
