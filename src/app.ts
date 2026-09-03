import sampleSource from "./content/sample.tex?raw";
import { SourceStorage } from "./services/source-storage";
import {
  StellarLatexEngine,
  type EngineKind,
} from "./services/stellar-latex-engine";
import { EditorView } from "./views/editor-view";
import { PdfPreviewView } from "./views/pdf-preview-view";
import { WorkspaceView } from "./views/workspace-view";

function engineName(kind: EngineKind): string {
  return kind === "pdftex" ? "pdfTeX" : "XeTeX";
}

function firstUsefulError(log: string, status: number): string {
  const errorLine = log
    .split("\n")
    .find((line) => line.startsWith("!") || /error/i.test(line));
  return errorLine?.replace(/^!\s*/, "") || "The engine exited with status " + status + ".";
}

export class LatexWorkspaceApp {
  private readonly storage = new SourceStorage();
  private readonly workspace = new WorkspaceView();
  private readonly editor = new EditorView(
    this.workspace.editorHost,
    this.storage.load(sampleSource),
  );
  private readonly preview = new PdfPreviewView(
    this.workspace.previewStage,
    this.workspace.pdfPreview,
  );

  private engine?: StellarLatexEngine;
  private isCompiling = false;
  private lastCompiledSource = "";
  private isStarted = false;

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    this.editor.onChange((source, lineCount) => {
      this.storage.save(source);
      this.updateEditorStats(lineCount, source);
    });
    this.editor.onCompile(() => void this.compile());
    this.workspace.onCompile(() => void this.compile());
    this.workspace.onDownload(() => this.preview.download());
    this.workspace.onReset(() => {
      this.editor.setSource(sampleSource);
      this.editor.focus();
    });
    this.workspace.onEngineChange((kind) => void this.changeEngine(kind));

    this.updateEditorStats(this.editor.lineCount, this.editor.source);
    void this.loadEngine(this.workspace.selectedEngine, true);
  }

  dispose(): void {
    this.storage.save(this.editor.source);
    this.engine?.dispose();
    this.preview.dispose();
    this.editor.dispose();
    this.workspace.dispose();
  }

  private updateEditorStats(lineCount: number, source: string): void {
    this.workspace.setSourceStats(lineCount, source.length);
    this.workspace.setDirty(source !== this.lastCompiledSource);
  }

  private async changeEngine(kind: EngineKind): Promise<void> {
    this.clearPreview();
    this.workspace.showEmpty();
    this.lastCompiledSource = "";
    this.updateEditorStats(this.editor.lineCount, this.editor.source);
    await this.loadEngine(kind);
  }

  private async loadEngine(kind: EngineKind, compileWhenReady = false): Promise<void> {
    this.engine?.dispose();
    this.engine = undefined;
    this.workspace.setControls({
      canCompile: false,
      canSelectEngine: false,
      isCompiling: false,
    });
    this.workspace.setDuration("");
    this.workspace.setStatus(
      "loading",
      "Starting " + engineName(kind) + "…",
      "Loading the WebAssembly runtime",
    );

    const startedAt = performance.now();
    const nextEngine = new StellarLatexEngine(kind, (message) => {
      this.workspace.setStatusDetail(message.replace(/^Loading resource\s+/i, "Fetching "));
    });

    try {
      await nextEngine.load();
      this.engine = nextEngine;
      const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
      this.workspace.setStatus(
        "ready",
        engineName(kind) + " is ready",
        "WebAssembly loaded in " + duration + "s",
      );
      this.workspace.setControls({
        canCompile: true,
        canSelectEngine: true,
        isCompiling: false,
      });
      if (compileWhenReady) await this.compile();
    } catch (error) {
      nextEngine.dispose();
      const message = error instanceof Error ? error.message : String(error);
      this.workspace.setControls({
        canCompile: false,
        canSelectEngine: true,
        isCompiling: false,
      });
      this.workspace.setStatus(
        "error",
        engineName(kind) + " could not start",
        message,
      );
      this.showError(
        "The engine assets could not be loaded. Run “pnpm engine:download” and refresh the page.",
      );
    }
  }

  private async compile(): Promise<void> {
    if (!this.engine || this.isCompiling) return;
    this.isCompiling = true;
    this.workspace.setControls({
      canCompile: false,
      canSelectEngine: false,
      isCompiling: true,
    });
    this.workspace.hideMessages();
    this.workspace.setDuration("");
    this.workspace.setStatus(
      "compiling",
      "Running " + engineName(this.engine.kind) + "…",
      "Typesetting main.tex locally",
    );

    const startedAt = performance.now();
    try {
      const source = this.editor.source;
      const result = await this.engine.compile(source);
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
      this.workspace.setCompilerLog(result.log);
      this.workspace.setDuration(elapsed + "s");

      if (result.pdf) {
        await this.preview.render(result.pdf);
        this.workspace.setDownloadEnabled(true);
      }

      if (result.ok && result.pdf) {
        this.lastCompiledSource = source;
        this.updateEditorStats(this.editor.lineCount, this.editor.source);
        this.workspace.setStatus(
          "ready",
          "PDF compiled successfully",
          engineName(this.engine.kind) + " finished in " + elapsed + "s",
        );
        this.workspace.setLogOpen(false);
      } else {
        this.workspace.setStatus(
          "error",
          "Compilation failed",
          "Exit status " + result.status + " · See the compiler log",
        );
        this.showError(firstUsefulError(result.log, result.status));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.workspace.setCompilerLog(message);
      this.workspace.setStatus("error", "Compilation stopped", message);
      this.showError(message);
    } finally {
      this.isCompiling = false;
      this.workspace.setControls({
        canCompile: Boolean(this.engine),
        canSelectEngine: true,
        isCompiling: false,
      });
    }
  }

  private clearPreview(): void {
    this.preview.clear();
    this.workspace.setDownloadEnabled(false);
  }

  private showError(message: string): void {
    this.clearPreview();
    this.workspace.showError(message);
  }
}
