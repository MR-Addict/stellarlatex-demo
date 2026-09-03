export type EngineKind = "pdftex" | "xetex";

export interface CachedEngineFile {
  path: string;
  data: ArrayBuffer;
}

export interface EngineCacheSnapshot {
  version: number;
  engine: EngineKind;
  endpoint: string;
  resourceFiles: CachedEngineFile[];
  buildFiles: CachedEngineFile[];
  texlive200: Array<[string, string]>;
  texlive404: string[];
  pk200: Array<[string, string]>;
  pk404: string[];
  resourceBytes: number;
  buildBytes: number;
}

export interface CompileResult {
  ok: boolean;
  status: number;
  log: string;
  pdf?: ArrayBuffer;
  synctex?: ArrayBuffer;
  recoveredAfterAbort?: boolean;
}

interface InternalCompileResult extends CompileResult {
  abortReason?: string;
  cacheSnapshot?: EngineCacheSnapshot;
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
  abortReason?: string;
  cacheSnapshot?: EngineCacheSnapshot;
  restoredFiles?: number;
  restoredBytes?: number;
}

interface PendingRequest {
  expectedCommand: string;
  resolve: (message: WorkerMessage) => void;
  reject: (error: Error) => void;
  timeoutId?: number;
}

const ENGINE_FILES: Record<EngineKind, string> = {
  pdftex: "pdftex.wasm/stellarlatexpdftex.js",
  xetex: "xetex.wasm/stellarlatexxetex.js",
};

const ENGINE_CACHE_VERSION = 6;
const CACHE_COMMAND_TIMEOUT_MS = 15_000;

function cacheTransfers(snapshot: EngineCacheSnapshot): Transferable[] {
  return [...snapshot.resourceFiles, ...snapshot.buildFiles].map(
    (file) => file.data,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function combineLogs(first: string, second: string): string {
  return `${second}\n\n--- First attempt before worker restart ---\n${first}`;
}

export class StellarLatexEngine {
  private worker?: Worker;
  private readyPromise?: Promise<void>;
  private resolveReady?: () => void;
  private rejectReady?: (error: Error) => void;
  private pending?: PendingRequest;
  private initialCache?: EngineCacheSnapshot;

  constructor(
    readonly kind: EngineKind,
    private readonly onProgress?: (message: string) => void,
    initialCache?: EngineCacheSnapshot,
  ) {
    if (this.isCompatibleCache(initialCache)) this.initialCache = initialCache;
  }

  async load(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    const runtimeReady = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.readyPromise = runtimeReady.then(() => this.hydrateInitialCache());

    try {
      const workerPath = `${import.meta.env.BASE_URL}engine/${ENGINE_FILES[this.kind]}`;
      const workerUrl = new URL(workerPath, document.baseURI);
      workerUrl.searchParams.set("cachePatch", String(ENGINE_CACHE_VERSION));
      this.worker = new Worker(workerUrl, { name: `stellarlatex-${this.kind}` });
      this.worker.addEventListener("message", this.handleMessage);
      this.worker.addEventListener("error", this.handleError);
    } catch (error) {
      const workerError = error instanceof Error ? error : new Error(String(error));
      this.rejectReady?.(workerError);
      this.rejectReady = undefined;
      this.resolveReady = undefined;
      this.worker = undefined;
    }

    return this.readyPromise;
  }

  async compile(source: string): Promise<CompileResult> {
    if (!this.worker) await this.load();
    let firstResult: InternalCompileResult | undefined;
    let firstFailure = "The WebAssembly runtime stopped without a compiler log.";

    try {
      firstResult = await this.compileOnce(source);
      if (firstResult.status !== -254) return firstResult;
      firstFailure = firstResult.log;
      if (this.isCompatibleCache(firstResult.cacheSnapshot)) {
        this.initialCache = firstResult.cacheSnapshot;
      }
    } catch (error) {
      if (!this.isRuntimeAbort(error)) throw error;
      firstFailure = error instanceof Error ? error.message : String(error);
    }

    this.onProgress?.("The worker stopped; restarting and retrying once…");
    this.terminateWorker();
    await this.load();

    let retryResult: InternalCompileResult;
    try {
      retryResult = await this.compileOnce(source);
    } catch (error) {
      if (!this.isRuntimeAbort(error)) throw error;
      const retryFailure = error instanceof Error ? error.message : String(error);
      this.terminateWorker();
      return {
        ok: false,
        status: -254,
        log: combineLogs(firstFailure, retryFailure),
      };
    }

    if (retryResult.status === -254) {
      if (this.isCompatibleCache(retryResult.cacheSnapshot)) {
        this.initialCache = retryResult.cacheSnapshot;
      }
      retryResult.ok = false;
      retryResult.pdf = undefined;
      retryResult.synctex = undefined;
      retryResult.log = combineLogs(firstFailure, retryResult.log);
      this.terminateWorker();
      return retryResult;
    }

    retryResult.log = combineLogs(firstFailure, retryResult.log);
    if (retryResult.ok) retryResult.recoveredAfterAbort = true;
    return retryResult;
  }

  async exportCache(): Promise<EngineCacheSnapshot | undefined> {
    if (!this.worker) {
      return this.isCompatibleCache(this.initialCache) ? this.initialCache : undefined;
    }

    try {
      await this.readyPromise;
      const response = await this.sendAndWait(
        { cmd: "exportcache" },
        "exportcache",
        CACHE_COMMAND_TIMEOUT_MS,
      );
      return this.isCompatibleCache(response.cacheSnapshot)
        ? response.cacheSnapshot
        : undefined;
    } catch {
      return this.isCompatibleCache(this.initialCache) ? this.initialCache : undefined;
    }
  }

  dispose(): void {
    this.terminateWorker();
    this.initialCache = undefined;
  }

  private async hydrateInitialCache(): Promise<void> {
    const cache = this.initialCache;
    this.initialCache = undefined;
    if (!this.isCompatibleCache(cache)) return;

    this.onProgress?.(
      `Restoring ${cache.resourceFiles.length} cached TeX resources (${formatBytes(cache.resourceBytes)})…`,
    );

    try {
      const response = await this.sendAndWait(
        { cmd: "hydratecache", cacheSnapshot: cache },
        "hydratecache",
        CACHE_COMMAND_TIMEOUT_MS,
        cacheTransfers(cache),
      );
      const restoredFiles = response.restoredFiles ?? 0;
      const restoredBytes = response.restoredBytes ?? 0;
      this.onProgress?.(
        `Restored ${restoredFiles} TeX resources (${formatBytes(restoredBytes)})`,
      );
    } catch (error) {
      if (!this.worker) throw error;
      this.onProgress?.("The saved compiler cache was unavailable; continuing cold…");
    }
  }

  private async compileOnce(source: string): Promise<InternalCompileResult> {
    if (!this.worker) throw new Error("The engine has not been loaded.");
    await this.readyPromise;

    // Worker messages are processed in order. The write acknowledgement also
    // guarantees that the preceding workspace cleanup has completed. Keep the
    // build area intact so the native controller can reuse auxiliary state.
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
      abortReason: response.abortReason,
      cacheSnapshot: response.cacheSnapshot,
    };
  }

  private isCompatibleCache(
    cache: EngineCacheSnapshot | undefined,
  ): cache is EngineCacheSnapshot {
    return (
      cache?.version === ENGINE_CACHE_VERSION &&
      cache.engine === this.kind &&
      Array.isArray(cache.resourceFiles) &&
      Array.isArray(cache.buildFiles)
    );
  }

  private isRuntimeAbort(error: unknown): boolean {
    return error instanceof Error && /abort|runtimeerror|webassembly/i.test(error.message);
  }

  private terminateWorker(): void {
    if (this.pending?.timeoutId !== undefined) {
      window.clearTimeout(this.pending.timeoutId);
    }
    this.pending?.reject(new Error("Engine closed before the request completed."));
    this.pending = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.readyPromise = undefined;
    this.resolveReady = undefined;
    this.rejectReady = undefined;
  }

  private sendAndWait(
    message: Record<string, unknown>,
    expectedCommand: string,
    timeoutMs = 0,
    transfers: Transferable[] = [],
  ): Promise<WorkerMessage> {
    if (!this.worker) return Promise.reject(new Error("Engine is unavailable."));
    if (this.pending) {
      return Promise.reject(new Error("The engine is already processing a command."));
    }

    return new Promise((resolve, reject) => {
      const request: PendingRequest = { expectedCommand, resolve, reject };
      if (timeoutMs > 0) {
        request.timeoutId = window.setTimeout(() => {
          if (this.pending !== request) return;
          this.pending = undefined;
          reject(new Error(`Engine command “${expectedCommand}” timed out.`));
        }, timeoutMs);
      }
      this.pending = request;
      try {
        this.worker?.postMessage(message, transfers);
      } catch (error) {
        if (request.timeoutId !== undefined) window.clearTimeout(request.timeoutId);
        if (this.pending === request) this.pending = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
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
      if (pending.timeoutId !== undefined) window.clearTimeout(pending.timeoutId);
      if (message.result === "failed" && message.cmd !== "compile") {
        pending.reject(
          new Error(message.message || `Engine command “${message.cmd}” failed.`),
        );
      } else {
        pending.resolve(message);
      }
    }
  };

  private handleError = (event: ErrorEvent): void => {
    if (event.currentTarget !== this.worker) return;
    event.preventDefault();
    const error = new Error(event.message || "The WebAssembly worker failed to load.");
    const pending = this.pending;
    if (pending?.timeoutId !== undefined) window.clearTimeout(pending.timeoutId);
    this.pending = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.rejectReady?.(error);
    this.rejectReady = undefined;
    this.resolveReady = undefined;
    pending?.reject(error);
  };
}
