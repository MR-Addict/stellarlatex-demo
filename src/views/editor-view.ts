import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import MonacoEditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

let isMonacoConfigured = false;

function configureMonaco(): void {
  if (isMonacoConfigured) return;
  isMonacoConfigured = true;

  window.MonacoEnvironment = {
    getWorker: () => new MonacoEditorWorker(),
  };

  monaco.languages.register({
    id: "latex",
    extensions: [".tex"],
    aliases: ["LaTeX", "latex"],
  });
  monaco.languages.setLanguageConfiguration("latex", {
    comments: { lineComment: "%" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "$", close: "$" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "$", close: "$" },
    ],
  });
  monaco.languages.setMonarchTokensProvider("latex", {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [
          /\\(?:documentclass|usepackage|begin|end|title|author|date|maketitle|section|subsection|subsubsection|paragraph|label|ref|cite|item|caption|includegraphics|definecolor|hypersetup)\b/,
          "keyword",
        ],
        [
          /\\(?:textbf|textit|texttt|textcolor|underline|href|verb|footnote|frac|sqrt|sum|exp|LaTeX|today)\b/,
          "type.identifier",
        ],
        [/\\[a-zA-Z@]+|\\./, "tag"],
        [/\$\$[^$]*\$\$|\$[^$\n]*\$/, "string"],
        [/[{}\[\]()]/, "delimiter"],
        [/&|\\\\/, "operator"],
        [/\b\d+(?:\.\d+)?\b/, "number"],
      ],
    },
  });
  monaco.editor.defineTheme("stellar-latex", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5F7891", fontStyle: "italic" },
      { token: "keyword", foreground: "78B7F2", fontStyle: "bold" },
      { token: "type.identifier", foreground: "5DD6A7" },
      { token: "tag", foreground: "A6C8E8" },
      { token: "string", foreground: "E5C07B" },
      { token: "number", foreground: "D7A6FF" },
      { token: "operator", foreground: "6ECAC8" },
      { token: "delimiter", foreground: "8398AD" },
    ],
    colors: {
      "editor.background": "#09131F",
      "editor.foreground": "#C2CFDC",
      "editorLineNumber.foreground": "#40556B",
      "editorLineNumber.activeForeground": "#8EA3B8",
      "editorCursor.foreground": "#8BC4FF",
      "editor.selectionBackground": "#2C5E8F66",
      "editor.inactiveSelectionBackground": "#234B704D",
      "editor.lineHighlightBackground": "#101D2B",
      "editorIndentGuide.background1": "#1B2A3A",
      "editorIndentGuide.activeBackground1": "#35506B",
    },
  });
}

export class EditorView {
  private readonly model: monaco.editor.ITextModel;
  private readonly editor: monaco.editor.IStandaloneCodeEditor;

  constructor(host: HTMLElement, initialSource: string) {
    configureMonaco();
    this.model = monaco.editor.createModel(initialSource, "latex");
    this.model.updateOptions({ tabSize: 2, insertSpaces: true });
    this.editor = monaco.editor.create(host, {
      model: this.model,
      theme: "stellar-latex",
      ariaLabel: "LaTeX source code",
      automaticLayout: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 22,
      padding: { top: 16, bottom: 16 },
      minimap: { enabled: false },
      glyphMargin: false,
      folding: true,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: "on",
      renderLineHighlight: "line",
      renderWhitespace: "selection",
      wordWrap: "off",
      stickyScroll: { enabled: false },
      bracketPairColorization: { enabled: true },
      overviewRulerBorder: false,
      fixedOverflowWidgets: true,
    });
  }

  get source(): string {
    return this.model.getValue();
  }

  get lineCount(): number {
    return this.model.getLineCount();
  }

  setSource(source: string): void {
    this.editor.setValue(source);
  }

  onChange(listener: (source: string, lineCount: number) => void): monaco.IDisposable {
    return this.model.onDidChangeContent(() => listener(this.source, this.lineCount));
  }

  onCompile(listener: () => void): void {
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, listener);
  }

  focus(): void {
    this.editor.focus();
  }

  dispose(): void {
    this.editor.dispose();
    this.model.dispose();
  }
}
