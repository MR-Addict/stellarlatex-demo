import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = fileURLToPath(new URL("..", import.meta.url));
const engineScripts = [
  {
    kind: "pdftex",
    path: "pdftex.wasm/stellarlatexpdftex.js",
  },
  {
    kind: "xetex",
    path: "xetex.wasm/stellarlatexxetex.js",
  },
];

const patchVersion = 6;
const patchMarker = `STELLAR_CACHE_PATCH_VERSION = ${patchVersion}`;

function cacheBridge(kind) {
  return `const STELLAR_CACHE_PATCH_VERSION = ${patchVersion};
const STELLAR_CACHE_ENGINE = "${kind}";
const STELLAR_RESOURCE_CACHE_LIMIT = 64 * 1024 * 1024;
const STELLAR_BUILD_CACHE_LIMIT = 16 * 1024 * 1024;
const STELLAR_BUILD_TMP_FILES = new Set(["/tmp/hash.db", "/tmp/cache.db"]);
let stellarStableBuildFiles = [];

function stellarIsSafePath(path, root) {
  return path.startsWith(root + "/") && !path.split("/").includes("..");
}

function stellarIsBuildArtifact(path) {
  return /\\.(?:pdf|xdv|synctex\\.gz|log)$/i.test(path);
}

function stellarIsSafeBuildPath(path) {
  return (
    (stellarIsSafePath(path, OUTPUTROOT) && !stellarIsBuildArtifact(path)) ||
    STELLAR_BUILD_TMP_FILES.has(path)
  );
}

function stellarEnsureParent(path) {
  const parts = path.split("/").filter(Boolean);
  let parent = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    parent += "/" + parts[index];
    if (!FS.analyzePath(parent).exists) FS.mkdir(parent);
  }
}

function stellarListFiles(root, include) {
  const files = [];
  const visit = (directory) => {
    for (const name of FS.readdir(directory)) {
      if (name === "." || name === "..") continue;
      const path = directory + "/" + name;
      const stat = FS.stat(path);
      if (FS.isDir(stat.mode)) visit(path);
      else if (!include || include(path)) files.push({ path, size: stat.size });
    }
  };
  if (FS.analyzePath(root).exists) visit(root);
  return files;
}

function stellarReadFiles(files) {
  return files.map(({ path }) => {
    const bytes = FS.readFile(path, { encoding: "binary" });
    return { path, data: bytes.slice().buffer };
  });
}

function stellarSelectResourceFiles() {
  const candidates = stellarListFiles(TEXCACHEROOT).sort(
    (left, right) => left.size - right.size,
  );
  const selected = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (bytes + candidate.size > STELLAR_RESOURCE_CACHE_LIMIT) continue;
    selected.push(candidate);
    bytes += candidate.size;
  }
  return { files: stellarReadFiles(selected), bytes };
}

function stellarCaptureStableBuild() {
  const outputFiles = stellarListFiles(
    OUTPUTROOT,
    (path) => !stellarIsBuildArtifact(path),
  );
  const tmpFiles = [...STELLAR_BUILD_TMP_FILES]
    .filter((path) => FS.analyzePath(path).exists)
    .map((path) => ({ path, size: FS.stat(path).size }));
  const candidates = [...outputFiles, ...tmpFiles];
  const bytes = candidates.reduce((total, file) => total + file.size, 0);
  stellarStableBuildFiles =
    bytes <= STELLAR_BUILD_CACHE_LIMIT ? stellarReadFiles(candidates) : [];
}

function stellarMapEntries(cache, includedPaths) {
  return Object.entries(cache).filter(([, path]) => includedPaths.has(path));
}

function stellarCreateCacheSnapshot(buildState = "all") {
  const resources = stellarSelectResourceFiles();
  const includedPaths = new Set(resources.files.map((file) => file.path));
  const buildFiles =
    buildState === "none"
      ? []
      : stellarStableBuildFiles
          .filter(
            (file) =>
              buildState === "all" || stellarIsSafePath(file.path, OUTPUTROOT),
          )
          .map((file) => ({
            path: file.path,
            data: file.data.slice(0),
          }));
  return {
    version: STELLAR_CACHE_PATCH_VERSION,
    engine: STELLAR_CACHE_ENGINE,
    endpoint: self.texlive_endpoint,
    resourceFiles: resources.files,
    buildFiles,
    texlive200: stellarMapEntries(texlive200_cache, includedPaths),
    texlive404: Object.keys(texlive404_cache),
    pk200: stellarMapEntries(pk200_cache, includedPaths),
    pk404: Object.keys(pk404_cache),
    resourceBytes: resources.bytes,
    buildBytes: buildFiles.reduce((total, file) => total + file.data.byteLength, 0),
  };
}

function stellarSnapshotTransfers(snapshot) {
  return [...snapshot.resourceFiles, ...snapshot.buildFiles].map(
    (file) => file.data,
  );
}

function stellarWriteCachedFile(file, root) {
  if (!file || typeof file.path !== "string" || !(file.data instanceof ArrayBuffer)) {
    return false;
  }
  if (!stellarIsSafePath(file.path, root)) return false;
  stellarEnsureParent(file.path);
  FS.writeFile(file.path, new Uint8Array(file.data));
  return true;
}

function stellarValidateCachedFiles(files, limit, isAllowed, label) {
  if (!Array.isArray(files)) throw new Error(label + " cache is malformed.");
  const paths = new Set();
  let bytes = 0;
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !(file.data instanceof ArrayBuffer) ||
      !isAllowed(file.path) ||
      paths.has(file.path)
    ) {
      throw new Error(label + " cache contains an invalid file.");
    }
    paths.add(file.path);
    bytes += file.data.byteLength;
    if (bytes > limit) throw new Error(label + " cache exceeds its size limit.");
  }
  return { paths, bytes };
}

function stellarHydrateCache(snapshot) {
  if (
    !snapshot ||
    snapshot.version !== STELLAR_CACHE_PATCH_VERSION ||
    snapshot.engine !== STELLAR_CACHE_ENGINE ||
    snapshot.endpoint !== self.texlive_endpoint
  ) {
    throw new Error("The engine cache snapshot is incompatible.");
  }

  const resources = stellarValidateCachedFiles(
    snapshot.resourceFiles,
    STELLAR_RESOURCE_CACHE_LIMIT,
    (path) => stellarIsSafePath(path, TEXCACHEROOT),
    "TeX resource",
  );
  const build = stellarValidateCachedFiles(
    snapshot.buildFiles,
    STELLAR_BUILD_CACHE_LIMIT,
    stellarIsSafeBuildPath,
    "Build-state",
  );
  if (
    snapshot.resourceBytes !== resources.bytes ||
    snapshot.buildBytes !== build.bytes
  ) {
    throw new Error("The engine cache snapshot size metadata is invalid.");
  }

  const restoredResources = new Set();
  let restoredBytes = 0;
  for (const file of snapshot.resourceFiles || []) {
    if (stellarWriteCachedFile(file, TEXCACHEROOT)) {
      restoredResources.add(file.path);
      restoredBytes += file.data.byteLength;
    }
  }

  for (const file of snapshot.buildFiles) {
    stellarEnsureParent(file.path);
    FS.writeFile(file.path, new Uint8Array(file.data));
  }

  const restoreMap = (entries) =>
    Object.fromEntries(
      (entries || []).filter(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          restoredResources.has(entry[1]),
      ),
    );
  const restoreMisses = (keys) =>
    Object.fromEntries((keys || []).map((key) => [key, 1]));

  texlive200_cache = restoreMap(snapshot.texlive200);
  texlive404_cache = restoreMisses(snapshot.texlive404);
  pk200_cache = restoreMap(snapshot.pk200);
  pk404_cache = restoreMisses(snapshot.pk404);
  stellarStableBuildFiles = snapshot.buildFiles.map((file) => ({
    path: file.path,
    data: file.data.slice(0),
  }));

  return {
    restoredFiles: restoredResources.size,
    restoredBytes,
  };
}

function stellarExportCacheRoutine() {
  try {
    const cacheSnapshot = stellarCreateCacheSnapshot();
    self.postMessage(
      { result: "ok", cmd: "exportcache", cacheSnapshot },
      stellarSnapshotTransfers(cacheSnapshot),
    );
  } catch (error) {
    self.postMessage({
      result: "failed",
      cmd: "exportcache",
      message: String(error),
    });
  }
}

function stellarHydrateCacheRoutine(snapshot) {
  try {
    const restored = stellarHydrateCache(snapshot);
    self.postMessage({ result: "ok", cmd: "hydratecache", ...restored });
  } catch (error) {
    self.postMessage({
      result: "failed",
      cmd: "hydratecache",
      message: String(error),
    });
  }
}
`;
}

const abortHandler = `Module["onAbort"] = function (reason) {
  const abortReason = String(reason ?? "unknown reason");
  self.memlog += "\\n[StellarLatex] Worker aborted: " + abortReason;
  let cacheSnapshot;
  try {
    cacheSnapshot = stellarCreateCacheSnapshot();
  } catch (error) {
    self.memlog += "\\n[StellarLatex] Cache snapshot failed: " + String(error);
  }

  const message = {
    result: "failed",
    status: -254,
    log: self.memlog,
    abortReason,
    cacheSnapshot,
    cmd: "compile",
  };
  self.postMessage(
    message,
    cacheSnapshot ? stellarSnapshotTransfers(cacheSnapshot) : [],
  );
};`;

function replaceFunction(source, startMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf("\n};", start);
  if (start < 0 || end < 0) {
    throw new Error(`Could not locate ${startMarker}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end + 3)}`;
}

function insertOnce(source, anchor, insertion, description) {
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`Could not locate ${description}.`);
  return `${source.slice(0, index)}${insertion}${source.slice(index)}`;
}

for (const engine of engineScripts) {
  const path = join(demoRoot, "public", "engine", engine.path);
  let source = await readFile(path, "utf8");
  if (source.includes(patchMarker)) continue;

  const previousPatchStart = source.indexOf(
    "const STELLAR_CACHE_PATCH_VERSION = ",
  );
  if (previousPatchStart >= 0) {
    const previousAbortStart = source.indexOf(
      'Module["onAbort"] = function',
      previousPatchStart,
    );
    if (previousAbortStart < 0) {
      throw new Error(`Could not upgrade the cache patch in ${engine.path}.`);
    }
    source =
      source.slice(0, previousPatchStart) + source.slice(previousAbortStart);
  }

  source = replaceFunction(source, 'Module["onAbort"] = function', abortHandler);
  source = insertOnce(
    source,
    abortHandler,
    cacheBridge(engine.kind),
    "the cache bridge insertion point",
  );

  const successPost = `    self.postMessage(
      {
        result: "ok",
        status,
        log: self.memlog,
        pdf: pdfArrayBuffer.buffer,`;
  if (!source.includes("    stellarCaptureStableBuild();\n    self.postMessage(")) {
    source = insertOnce(
      source,
      successPost,
      "    stellarCaptureStableBuild();\n",
      "the successful compile response",
    );
  }

  const commandAnchor = `  } else if (cmd === "grace") {`;
  const cacheCommands = `  } else if (cmd === "exportcache") {
    stellarExportCacheRoutine();
  } else if (cmd === "hydratecache") {
    stellarHydrateCacheRoutine(data["cacheSnapshot"]);
`;
  if (!source.includes('cmd === "exportcache"')) {
    source = insertOnce(
      source,
      commandAnchor,
      cacheCommands,
      "the worker command switch",
    );
  }

  const markerCount = source.split(patchMarker).length - 1;
  if (
    markerCount !== 1 ||
    !source.includes('cmd === "exportcache"') ||
    !source.includes('cmd === "hydratecache"')
  ) {
    throw new Error(`Engine cache preparation failed validation for ${engine.path}.`);
  }

  await writeFile(path, source);
  console.log(`Prepared cache-safe abort recovery in ${engine.path}.`);
}
