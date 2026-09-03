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

interface CachedCompile {
  source: string;
  pdf: ArrayBuffer;
  log: string;
}

interface DisplayedCompile {
  kind: EngineKind;
  source: string;
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
  private readonly compileCache = new Map<EngineKind, CachedCompile>();
  private displayedCompile?: DisplayedCompile;
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
    this.compileCache.clear();
    this.displayedCompile = undefined;
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
    const engine = this.engine;
    const kind = engine.kind;
    const source = this.editor.source;
    const cached = this.compileCache.get(kind);

    this.isCompiling = true;
    this.workspace.setControls({
      canCompile: false,
      canSelectEngine: false,
      isCompiling: true,
    });
    this.workspace.hideMessages();
    this.workspace.setDuration("");

    try {
      if (cached?.source === source) {
        await this.restoreCachedCompile(kind, cached);
        return;
      }

      this.workspace.setStatus(
        "compiling",
        "Running " + engineName(kind) + "…",
        "Typesetting main.tex locally",
      );

      const startedAt = performance.now();
      const result = await engine.compile(source);
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
      this.workspace.setCompilerLog(result.log);
      this.workspace.setDuration(elapsed + "s");

      if (result.pdf) {
        await this.preview.render(result.pdf);
        this.workspace.setDownloadEnabled(true);
      }

      if (result.ok && result.pdf) {
        this.compileCache.set(kind, {
          source,
          pdf: result.pdf,
          log: result.log,
        });
        this.displayedCompile = { kind, source };
        this.lastCompiledSource = source;
        this.updateEditorStats(this.editor.lineCount, this.editor.source);
        this.workspace.setStatus(
          "ready",
          "PDF compiled successfully",
          engineName(kind) + " finished in " + elapsed + "s",
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

  private async restoreCachedCompile(
    kind: EngineKind,
    cached: CachedCompile,
  ): Promise<void> {
    const isAlreadyDisplayed =
      this.displayedCompile?.kind === kind &&
      this.displayedCompile.source === cached.source;

    if (!isAlreadyDisplayed) {
      this.workspace.setStatus(
        "compiling",
        "Restoring cached PDF…",
        "Rendering the last successful result",
      );
      await this.preview.render(cached.pdf);
    }

    this.displayedCompile = { kind, source: cached.source };
    this.lastCompiledSource = cached.source;
    this.workspace.setCompilerLog(cached.log);
    this.workspace.setDownloadEnabled(true);
    this.workspace.setDuration("Cached");
    this.updateEditorStats(this.editor.lineCount, this.editor.source);
    this.workspace.setStatus(
      "ready",
      "PDF restored from cache",
      engineName(kind) + " reused the last successful result",
    );
    this.workspace.setLogOpen(false);
  }

  private clearPreview(): void {
    this.preview.clear();
    this.displayedCompile = undefined;
    this.workspace.setDownloadEnabled(false);
  }

  private showError(message: string): void {
    this.clearPreview();
    this.workspace.showError(message);
  }
}
