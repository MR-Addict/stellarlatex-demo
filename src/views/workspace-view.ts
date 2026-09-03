import type { EngineKind } from "../services/stellar-latex-engine";

export type WorkspaceStatus = "loading" | "ready" | "compiling" | "error";

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}

interface ControlState {
  canCompile: boolean;
  canSelectEngine: boolean;
  isCompiling: boolean;
}

export class WorkspaceView {
  readonly editorHost = getElement<HTMLDivElement>("source-editor");
  readonly previewStage = getElement<HTMLDivElement>("preview-stage");
  readonly pdfPreview = getElement<HTMLDivElement>("pdf-preview");

  private readonly sourceStats = getElement<HTMLSpanElement>("source-stats");
  private readonly dirtyIndicator = getElement<HTMLSpanElement>("dirty-indicator");
  private readonly engineSelect = getElement<HTMLSelectElement>("engine-select");
  private readonly compileButton = getElement<HTMLButtonElement>("compile-button");
  private readonly compileLabel = getElement<HTMLSpanElement>("compile-label");
  private readonly resetButton = getElement<HTMLButtonElement>("reset-button");
  private readonly downloadButton = getElement<HTMLButtonElement>("download-button");
  private readonly statusLight = getElement<HTMLSpanElement>("status-light");
  private readonly statusLabel = getElement<HTMLSpanElement>("status-label");
  private readonly durationLabel = getElement<HTMLSpanElement>("duration-label");
  private readonly enginePulse = getElement<HTMLSpanElement>("engine-pulse");
  private readonly engineStateLabel = getElement<HTMLElement>("engine-state-label");
  private readonly engineStateDetail = getElement<HTMLElement>("engine-state-detail");
  private readonly emptyState = getElement<HTMLDivElement>("empty-state");
  private readonly errorState = getElement<HTMLDivElement>("error-state");
  private readonly errorMessage = getElement<HTMLParagraphElement>("error-message");
  private readonly compilerLog = getElement<HTMLPreElement>("compiler-log");
  private readonly logDrawer = getElement<HTMLElement>("log-drawer");
  private readonly logButton = getElement<HTMLButtonElement>("log-button");
  private readonly closeLogButton = getElement<HTMLButtonElement>("close-log-button");
  private readonly showLogButton = getElement<HTMLButtonElement>("show-log-button");
  private readonly events = new AbortController();

  constructor() {
    const options = { signal: this.events.signal };
    this.logButton.addEventListener("click", () => this.setLogOpen(this.logDrawer.hidden), options);
    this.closeLogButton.addEventListener("click", () => this.setLogOpen(false), options);
    this.showLogButton.addEventListener("click", () => this.setLogOpen(true), options);
  }

  get selectedEngine(): EngineKind {
    return this.engineSelect.value as EngineKind;
  }

  onCompile(listener: () => void): void {
    this.compileButton.addEventListener("click", listener, { signal: this.events.signal });
    document.addEventListener(
      "keydown",
      (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          listener();
        }
      },
      { signal: this.events.signal },
    );
  }

  onDownload(listener: () => void): void {
    this.downloadButton.addEventListener("click", listener, { signal: this.events.signal });
  }

  onReset(listener: () => void): void {
    this.resetButton.addEventListener("click", listener, { signal: this.events.signal });
  }

  onEngineChange(listener: (kind: EngineKind) => void): void {
    this.engineSelect.addEventListener("change", () => listener(this.selectedEngine), {
      signal: this.events.signal,
    });
  }

  setControls({ canCompile, canSelectEngine, isCompiling }: ControlState): void {
    this.compileButton.classList.toggle("is-loading", isCompiling);
    this.compileButton.disabled = !canCompile || isCompiling;
    this.compileLabel.textContent = isCompiling ? "Compiling…" : "Compile";
    this.engineSelect.disabled = !canSelectEngine || isCompiling;
  }

  setStatus(state: WorkspaceStatus, title: string, detail: string): void {
    this.enginePulse.dataset.state = state;
    this.statusLight.dataset.state = state;
    this.engineStateLabel.textContent = title;
    this.engineStateDetail.textContent = detail;
    this.statusLabel.textContent =
      state === "loading"
        ? "Loading engine"
        : state === "compiling"
          ? "Compiling"
          : state === "error"
            ? "Build failed"
            : "Preview ready";
  }

  setStatusDetail(detail: string): void {
    this.engineStateDetail.textContent = detail;
  }

  setSourceStats(lineCount: number, characterCount: number): void {
    this.sourceStats.textContent = `${lineCount} lines · ${characterCount.toLocaleString()} characters`;
  }

  setDirty(isDirty: boolean): void {
    this.dirtyIndicator.classList.toggle("visible", isDirty);
  }

  setDuration(duration: string): void {
    this.durationLabel.textContent = duration;
  }

  setCompilerLog(log: string): void {
    this.compilerLog.textContent = log;
  }

  setDownloadEnabled(enabled: boolean): void {
    this.downloadButton.disabled = !enabled;
  }

  showEmpty(): void {
    this.emptyState.hidden = false;
    this.errorState.hidden = true;
  }

  hideMessages(): void {
    this.emptyState.hidden = true;
    this.errorState.hidden = true;
  }

  showError(message: string): void {
    this.emptyState.hidden = true;
    this.errorState.hidden = false;
    this.errorMessage.textContent = message;
  }

  setLogOpen(open: boolean): void {
    this.logDrawer.hidden = !open;
    this.logButton.setAttribute("aria-expanded", String(open));
    if (open) this.logDrawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  dispose(): void {
    this.events.abort();
  }
}
