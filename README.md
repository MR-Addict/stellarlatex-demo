# StellarLatex Vite demo

A small, dependency-light browser workspace for compiling LaTeX with the
StellarLatex WebAssembly workers.

## Run locally

```bash
pnpm install
pnpm dev
```

The first `dev` or `build` run downloads the latest
`stellarlatex-v*.zip` asset from the
[StellarLatex GitHub releases](https://github.com/Arxtect/StellarLatex/releases/latest)
page and extracts the pdfTeX and XeTeX assets into `public/engine/`. The files
are cached locally and excluded from Git.

The same preparation step copies PDF.js's packed Adobe CMaps into
`public/pdfjs/cmaps/`. The preview passes that directory as `cMapUrl`, allowing
PDF.js to decode CJK composite fonts in Chinese, Japanese, and Korean PDFs.

The downloaded worker scripts are also prepared with an abort-recovery handler.
Some package-heavy XeTeX runs stop during cleanup after the PDF has already
been written; the demo returns that completed PDF and starts a fresh worker for
the next compilation instead of exposing an uncaught WebAssembly exception.

To replace the cached engine with the latest release:

```bash
pnpm engine:update
```

## Production build

```bash
pnpm build
pnpm preview
```

Vite uses relative asset URLs, so the contents of `dist/` can be served from a
domain root, a subdirectory, or GitHub Pages.
