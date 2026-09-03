const DEFAULT_SOURCE_STORAGE_KEY = "stellarlatex:source:v1";

export class SourceStorage {
  constructor(private readonly key = DEFAULT_SOURCE_STORAGE_KEY) {}

  load(fallback: string): string {
    try {
      return window.localStorage.getItem(this.key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  save(source: string): void {
    try {
      window.localStorage.setItem(this.key, source);
    } catch {
      // Editing remains available when storage is blocked or full.
    }
  }
}
