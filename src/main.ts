import "./styles.css";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { StellarLatexEngine, type EngineKind } from "./stellar-engine";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const pdfAssetBaseUrl = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI);

const SAMPLE_SOURCE = String.raw`\documentclass[UTF8,11pt]{ctexart}

\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{hyperref}

\definecolor{stellarblue}{HTML}{2563A8}
\hypersetup{colorlinks=true,linkcolor=stellarblue,urlcolor=stellarblue}

\title{StellarLatex 中文示例}
\author{浏览器中的 \LaTeX{} 工作台}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
本文档展示常用的 \LaTeX{} 排版功能，并使用 XeTeX 在浏览器中完成编译。
源文件与生成的 PDF 都保留在本地，不会上传到服务器。
\end{abstract}

\section{文字与段落}

这是普通正文。你可以使用 \textbf{粗体}、\textit{斜体}、
\underline{下划线}，也可以用 \textcolor{stellarblue}{彩色文字}突出重点。
行内公式写作 $E=mc^2$，脚注则像这样添加\footnote{这是一个脚注示例。}。

\begin{quote}
优雅的排版，应当让读者关注内容本身，而不是排版工具。
\end{quote}

项目主页：\href{https://github.com/Arxtect/StellarLatex}{StellarLatex on GitHub}。

\section{列表}

无序列表适合并列内容：
\begin{itemize}
  \item 浏览器内运行 WebAssembly；
  \item 支持中文与数学公式；
  \item 一键生成并下载 PDF。
\end{itemize}

有序列表适合描述步骤：
\begin{enumerate}
  \item 编辑左侧的源代码；
  \item 点击“编译 PDF”；
  \item 在右侧查看结果。
\end{enumerate}

\section{数学公式}

正态分布密度函数为
\begin{equation*}
  f(x)=\frac{1}{\sigma\sqrt{2\pi}}
  \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right).
\end{equation*}
其中 $\mu$ 是均值，$\sigma$ 是标准差。上式还展示了
分数、根号、指数和自动伸缩括号。

多行公式可以使用 \texttt{align} 环境：
\begin{align*}
  (a+b)^2 &= a^2+2ab+b^2, \\
  \sum_{k=1}^{n} k &= \frac{n(n+1)}{2}.
\end{align*}

\section{表格与图片}

下面使用 \texttt{booktabs} 绘制一个常见的三线表。
\begin{table}[htbp]
  \centering
  \caption{浏览器 LaTeX 引擎对比}
  \begin{tabular}{lcc}
    \toprule
    引擎 & 中文支持 & 输出格式 \\
    \midrule
    pdfTeX & 需要额外字体配置 & PDF \\
    XeTeX  & 原生 Unicode 支持 & PDF \\
    \bottomrule
  \end{tabular}
\end{table}

下面是一个无需外部文件的图片占位区域。实际项目中可使用
\verb|\includegraphics[width=0.8\linewidth]{image.png}| 插入图片。
\begin{figure}[htbp]
  \centering
  \fbox{\rule{0pt}{3cm}\rule{0.72\linewidth}{0pt}}
  \caption{图片占位区域}
\end{figure}

\section{代码与参考文献}

简单代码可以放入 \texttt{verbatim} 环境：
\begin{verbatim}
for item in data:
    print(item)
\end{verbatim}

文献引用通常使用 \verb|\cite| 命令，并在文末通过参考文献环境列出来源。

\begin{thebibliography}{9}
  \bibitem{knuth1984texbook}
  Donald E. Knuth.
  \textit{The TeXbook}.
  Addison-Wesley, 1984.
\end{thebibliography}

\end{document}
`;

interface ReleaseManifest {
  tagName: string;
  assetName: string;
  browserDownloadUrl: string;
}

const get = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
};

const editor = get<HTMLTextAreaElement>("source-editor");
const lineNumbers = get<HTMLDivElement>("line-numbers");
const sourceStats = get<HTMLSpanElement>("source-stats");
const dirtyIndicator = get<HTMLSpanElement>("dirty-indicator");
const engineSelect = get<HTMLSelectElement>("engine-select");
const compileButton = get<HTMLButtonElement>("compile-button");
const compileLabel = get<HTMLSpanElement>("compile-label");
const resetButton = get<HTMLButtonElement>("reset-button");
const downloadButton = get<HTMLButtonElement>("download-button");
const statusLight = get<HTMLSpanElement>("status-light");
const statusLabel = get<HTMLSpanElement>("status-label");
const durationLabel = get<HTMLSpanElement>("duration-label");
const enginePulse = get<HTMLSpanElement>("engine-pulse");
const engineStateLabel = get<HTMLElement>("engine-state-label");
const engineStateDetail = get<HTMLElement>("engine-state-detail");
const emptyState = get<HTMLDivElement>("empty-state");
const errorState = get<HTMLDivElement>("error-state");
const errorMessage = get<HTMLParagraphElement>("error-message");
const previewStage = get<HTMLDivElement>("preview-stage");
const pdfPreview = get<HTMLDivElement>("pdf-preview");
const compilerLog = get<HTMLPreElement>("compiler-log");
const logDrawer = get<HTMLElement>("log-drawer");
const logButton = get<HTMLButtonElement>("log-button");
const closeLogButton = get<HTMLButtonElement>("close-log-button");
const showLogButton = get<HTMLButtonElement>("show-log-button");
const releaseLink = get<HTMLAnchorElement>("release-link");
const releaseVersion = get<HTMLElement>("release-version");
const footerVersion = get<HTMLElement>("footer-version");

let engine: StellarLatexEngine | undefined;
let isCompiling = false;
let pdfUrl: string | undefined;
let pdfDocument: PDFDocumentProxy | undefined;
let lastCompiledSource = "";

function engineName(kind: EngineKind): string {
  return kind === "pdftex" ? "pdfTeX" : "XeTeX";
}

function updateEditorStats(): void {
  const lines = editor.value.split("\n").length;
  lineNumbers.textContent = Array.from({ length: lines }, (_, index) => index + 1).join("\n");
  sourceStats.textContent = `${lines} lines · ${editor.value.length.toLocaleString()} characters`;
  dirtyIndicator.classList.toggle("visible", editor.value !== lastCompiledSource);
}

function setEngineStatus(
  state: "loading" | "ready" | "compiling" | "error",
  title: string,
  detail: string,
): void {
  enginePulse.dataset.state = state;
  statusLight.dataset.state = state;
  engineStateLabel.textContent = title;
  engineStateDetail.textContent = detail;
  statusLabel.textContent =
    state === "loading"
      ? "Loading engine"
      : state === "compiling"
        ? "Compiling"
        : state === "error"
          ? "Build failed"
          : "Preview ready";
}

function setLogOpen(open: boolean): void {
  logDrawer.hidden = !open;
  logButton.setAttribute("aria-expanded", String(open));
  if (open) logDrawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearPdf(): void {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = undefined;
  void pdfDocument?.cleanup();
  pdfDocument = undefined;
  pdfPreview.replaceChildren();
  pdfPreview.classList.remove("visible");
  downloadButton.disabled = true;
}

async function loadEngine(kind: EngineKind): Promise<void> {
  engine?.dispose();
  engine = undefined;
  compileButton.disabled = true;
  engineSelect.disabled = true;
  durationLabel.textContent = "";
  setEngineStatus("loading", `Starting ${engineName(kind)}…`, "Loading the WebAssembly runtime");

  const startedAt = performance.now();
  const nextEngine = new StellarLatexEngine(kind, (message) => {
    engineStateDetail.textContent = message.replace(/^Loading resource\s+/i, "Fetching ");
  });

  try {
    await nextEngine.load();
    engine = nextEngine;
    const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
    setEngineStatus("ready", `${engineName(kind)} is ready`, `WebAssembly loaded in ${duration}s`);
    compileButton.disabled = false;
    engineSelect.disabled = false;
  } catch (error) {
    nextEngine.dispose();
    engineSelect.disabled = false;
    const message = error instanceof Error ? error.message : String(error);
    setEngineStatus("error", `${engineName(kind)} could not start`, message);
    showError(
      "The engine assets could not be loaded. Run “pnpm engine:download” and refresh the page.",
    );
  }
}

async function compile(): Promise<void> {
  if (!engine || isCompiling) return;
  isCompiling = true;
  compileButton.classList.add("is-loading");
  compileButton.disabled = true;
  engineSelect.disabled = true;
  compileLabel.textContent = "Compiling…";
  emptyState.hidden = true;
  errorState.hidden = true;
  durationLabel.textContent = "";
  setEngineStatus("compiling", `Running ${engineName(engine.kind)}…`, "Typesetting main.tex locally");

  const startedAt = performance.now();
  try {
    const result = await engine.compile(editor.value);
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
    compilerLog.textContent = result.log;
    durationLabel.textContent = `${elapsed}s`;

    if (result.pdf) await showPdf(result.pdf);

    if (result.ok && result.pdf) {
      lastCompiledSource = editor.value;
      updateEditorStats();
      setEngineStatus("ready", "PDF compiled successfully", `${engineName(engine.kind)} finished in ${elapsed}s`);
      setLogOpen(false);
    } else {
      setEngineStatus("error", "Compilation failed", `Exit status ${result.status} · See the compiler log`);
      showError(firstUsefulError(result.log, result.status));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    compilerLog.textContent = message;
    setEngineStatus("error", "Compilation stopped", message);
    showError(message);
  } finally {
    isCompiling = false;
    compileButton.classList.remove("is-loading");
    compileButton.disabled = !engine;
    engineSelect.disabled = false;
    compileLabel.textContent = "Compile PDF";
  }
}

async function showPdf(buffer: ArrayBuffer): Promise<void> {
  clearPdf();
  pdfUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  pdfDocument = await getDocument({
    data: new Uint8Array(buffer.slice(0)),
    cMapUrl: new URL("cmaps/", pdfAssetBaseUrl).href,
    cMapPacked: true,
  }).promise;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const naturalViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(280, previewStage.clientWidth - 64);
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
    canvas.setAttribute("aria-label", `PDF page ${pageNumber} of ${pdfDocument.numPages}`);
    pdfPreview.append(canvas);

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    }).promise;
  }

  pdfPreview.classList.add("visible");
  downloadButton.disabled = false;
  errorState.hidden = true;
}

function showError(message: string): void {
  clearPdf();
  emptyState.hidden = true;
  errorState.hidden = false;
  errorMessage.textContent = message;
}

function firstUsefulError(log: string, status: number): string {
  const errorLine = log
    .split("\n")
    .find((line) => line.startsWith("!") || /error/i.test(line));
  return errorLine?.replace(/^!\s*/, "") || `The engine exited with status ${status}.`;
}

function downloadPdf(): void {
  if (!pdfUrl) return;
  const anchor = document.createElement("a");
  anchor.href = pdfUrl;
  anchor.download = "main.pdf";
  anchor.click();
}

async function loadReleaseMetadata(): Promise<void> {
  try {
    const manifestUrl = new URL(`${import.meta.env.BASE_URL}engine/release.json`, document.baseURI);
    const response = await fetch(manifestUrl);
    if (!response.ok) return;
    const manifest = (await response.json()) as ReleaseManifest;
    releaseVersion.textContent = manifest.tagName;
    releaseLink.href = manifest.browserDownloadUrl;
    releaseLink.title = `Download ${manifest.assetName} from GitHub`;
    footerVersion.textContent = `${engineName(engineSelect.value as EngineKind)} · ${manifest.tagName}`;
  } catch {
    // The GitHub releases page remains a valid fallback when metadata is absent.
  }
}

editor.addEventListener("input", updateEditorStats);
editor.addEventListener("scroll", () => {
  lineNumbers.scrollTop = editor.scrollTop;
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    updateEditorStats();
  }
});

compileButton.addEventListener("click", compile);
downloadButton.addEventListener("click", downloadPdf);
resetButton.addEventListener("click", () => {
  editor.value = SAMPLE_SOURCE;
  updateEditorStats();
  editor.focus();
});
engineSelect.addEventListener("change", async () => {
  clearPdf();
  emptyState.hidden = false;
  errorState.hidden = true;
  lastCompiledSource = "";
  updateEditorStats();
  const kind = engineSelect.value as EngineKind;
  footerVersion.textContent = `${engineName(kind)} · ${releaseVersion.textContent ?? "release"}`;
  await loadEngine(kind);
});
logButton.addEventListener("click", () => setLogOpen(logDrawer.hidden));
closeLogButton.addEventListener("click", () => setLogOpen(false));
showLogButton.addEventListener("click", () => setLogOpen(true));
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void compile();
  }
});
window.addEventListener("beforeunload", () => {
  engine?.dispose();
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
});

editor.value = SAMPLE_SOURCE;
updateEditorStats();
void loadReleaseMetadata();
void loadEngine("xetex");
