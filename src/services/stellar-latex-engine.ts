export type EngineKind = "pdftex" | "xetex";

export interface CompileResult {
  ok: boolean;
  status: number;
  log: string;
  pdf?: ArrayBuffer;
  synctex?: ArrayBuffer;
  recoveredAfterAbort?: boolean;
}

interface WorkerMessage {
  cmd?: string;
  result?: "ok" | "failed";
  status?: number;
  log?: string;
  message?: string;
  pdf?: ArrayBuffer;
  synctex?: ArrayBuffer;
  recoveredAfterAbort?: boolean;
}

interface PendingRequest {
  expectedCommand: string;
  resolve: (message: WorkerMessage) => void;
  reject: (error: Error) => void;
}

const ENGINE_FILES: Record<EngineKind, string> = {
  pdftex: "pdftex.wasm/stellarlatexpdftex.js",
  xetex: "xetex.wasm/stellarlatexxetex.js",
};

export class StellarLatexEngine {
  private worker?: Worker;
  private readyPromise?: Promise<void>;
  private resolveReady?: () => void;
  private rejectReady?: (error: Error) => void;
  private pending?: PendingRequest;

  constructor(
    readonly kind: EngineKind,
    private readonly onProgress?: (message: string) => void,
  ) {}

  async load(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    const workerPath = `${import.meta.env.BASE_URL}engine/${ENGINE_FILES[this.kind]}`;
    const workerUrl = new URL(workerPath, document.baseURI);
    this.worker = new Worker(workerUrl, { name: `stellarlatex-${this.kind}` });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);

    return this.readyPromise;
  }

  async compile(source: string): Promise<CompileResult> {
    if (!this.worker) await this.load();
    let firstResult: CompileResult | undefined;

    try {
      firstResult = await this.compileOnce(source);
      if (firstResult.recoveredAfterAbort) {
        await this.restartAfterRecovery();
        return firstResult;
      }
      if (firstResult.status !== -254) return firstResult;
    } catch (error) {
      if (!this.isRuntimeAbort(error)) throw error;
    }

    // The published XeTeX worker can intermittently abort after its first
    // package-heavy run. A fresh worker succeeds once those assets are in the
    // browser cache, so recover once without masking genuine TeX errors.
    this.onProgress?.("The WebAssembly worker stopped; restarting and retrying once…");
    this.dispose();
    await this.load();
    const retryResult = await this.compileOnce(source);

    if (retryResult.recoveredAfterAbort) {
      await this.restartAfterRecovery();
    }

    if (!retryResult.ok && firstResult?.log) {
      retryResult.log += `\n\n--- First attempt before worker restart ---\n${firstResult.log}`;
    }
    return retryResult;
  }

  private async compileOnce(source: string): Promise<CompileResult> {
    if (!this.worker) throw new Error("The engine has not been loaded.");
    await this.readyPromise;

    // Worker messages are processed in order. The write acknowledgement also
    // guarantees that the preceding workspace cleanup has completed. Do not
    // flush the build area here: the engine keeps internal state under /tmp.
    this.worker.postMessage({ cmd: "flushwork" });
    await this.sendAndWait(
      { cmd: "writefile", url: "main.tex", src: source },
      "writefile",
    );
    this.worker.postMessage({ cmd: "setmainfile", url: "main.tex" });

    const response = await this.sendAndWait({ cmd: "compilelatex" }, "compile");
    return {
      ok: response.result === "ok" && response.status === 0,
      status: response.status ?? -1,
      log: response.log ?? "No compiler log was returned.",
      pdf: response.pdf,
      synctex: response.synctex,
      recoveredAfterAbort: response.recoveredAfterAbort,
    };
  }

  private async restartAfterRecovery(): Promise<void> {
    this.onProgress?.("PDF recovered; preparing a fresh engine for the next run…");
    this.dispose();
    try {
      await this.load();
    } catch {
      // The recovered PDF is still valid. Leave the engine unloaded so the
      // next compile can make another clean initialization attempt.
      this.dispose();
    }
  }

  private isRuntimeAbort(error: unknown): boolean {
    return error instanceof Error && /abort|runtimeerror|webassembly/i.test(error.message);
  }

  dispose(): void {
    this.pending?.reject(new Error("Engine closed before the request completed."));
    this.pending = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.readyPromise = undefined;
  }

  private sendAndWait(
    message: Record<string, unknown>,
    expectedCommand: string,
  ): Promise<WorkerMessage> {
    if (!this.worker) return Promise.reject(new Error("Engine is unavailable."));
    if (this.pending) {
      return Promise.reject(new Error("The engine is already processing a command."));
    }

    return new Promise((resolve, reject) => {
      this.pending = { expectedCommand, resolve, reject };
      this.worker?.postMessage(message);
    });
  }

  private handleMessage = (event: MessageEvent<WorkerMessage>): void => {
    if (event.currentTarget !== this.worker) return;
    const message = event.data;

    if (message.cmd === "engine_compiling_log") {
      if (message.message) this.onProgress?.(message.message);
      return;
    }

    if (!message.cmd && message.result === "ok" && this.resolveReady) {
      this.resolveReady();
      this.resolveReady = undefined;
      this.rejectReady = undefined;
      return;
    }

    if (this.pending && message.cmd === this.pending.expectedCommand) {
      const pending = this.pending;
      this.pending = undefined;
      if (message.result === "failed" && message.cmd !== "compile") {
        pending.reject(new Error(`Engine command “${message.cmd}” failed.`));
      } else {
        pending.resolve(message);
      }
    }
  };

  private handleError = (event: ErrorEvent): void => {
    if (event.currentTarget !== this.worker) return;
    // Prevent the browser from reporting a handled worker failure as an
    // uncaught page-level exception. The pending request still rejects below.
    event.preventDefault();
    const error = new Error(event.message || "The WebAssembly worker failed to load.");
    this.rejectReady?.(error);
    this.rejectReady = undefined;
    this.resolveReady = undefined;
    this.pending?.reject(error);
    this.pending = undefined;
  };
}

