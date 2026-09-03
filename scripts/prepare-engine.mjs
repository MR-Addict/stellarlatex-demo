import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = fileURLToPath(new URL("..", import.meta.url));
const engineScripts = [
  "pdftex.wasm/stellarlatexpdftex.js",
  "xetex.wasm/stellarlatexxetex.js",
];

const abortHandler = `Module["onAbort"] = function (reason) {
  let recoveredPdf = null;
  try {
    const lastSlash = self.mainfile.lastIndexOf("/");
    const filename =
      lastSlash >= 0 ? self.mainfile.substring(lastSlash + 1) : self.mainfile;
    const extension = filename.lastIndexOf(".");
    const pdfurl =
      OUTPUTROOT + "/" + filename.substring(0, extension) + ".pdf";
    if (extension > 0 && FS.analyzePath(pdfurl).exists) {
      recoveredPdf = FS.readFile(pdfurl, { encoding: "binary" });
    }
  } catch (error) {
    console.error("Could not recover PDF after engine shutdown", error);
  }

  if (recoveredPdf) {
    self.memlog +=
      "\\n[StellarLatex] The engine stopped during cleanup; the completed PDF was recovered.";
    self.postMessage(
      {
        result: "ok",
        status: 0,
        log: self.memlog,
        pdf: recoveredPdf.buffer,
        recoveredAfterAbort: true,
        cmd: "compile",
      },
      [recoveredPdf.buffer],
    );
    return;
  }

  self.memlog += "Engine crashed: " + String(reason ?? "unknown reason");
  self.postMessage({
    result: "failed",
    status: -254,
    log: self.memlog,
    cmd: "compile",
  });
};`;

for (const relativePath of engineScripts) {
  const path = join(demoRoot, "public", "engine", relativePath);
  const source = await readFile(path, "utf8");
  if (source.includes("recoveredAfterAbort: true")) continue;

  const start = source.indexOf('Module["onAbort"] = function () {');
  const end = source.indexOf("\n};", start);
  if (start < 0 || end < 0) {
    throw new Error(`Could not locate the abort handler in ${relativePath}.`);
  }

  const patched = `${source.slice(0, start)}${abortHandler}${source.slice(end + 3)}`;
  await writeFile(path, patched);
  console.log(`Prepared abort recovery in ${relativePath}.`);
}
