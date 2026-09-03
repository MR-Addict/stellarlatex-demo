import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const REPOSITORY = "Arxtect/StellarLatex";
const REQUIRED_FILES = [
  "pdftex.wasm/stellarlatexpdftex.js",
  "pdftex.wasm/stellarlatexpdftex.wasm",
  "xetex.wasm/stellarlatexxetex.js",
  "xetex.wasm/stellarlatexxetex.wasm",
];

const demoRoot = fileURLToPath(new URL("..", import.meta.url));
const targetDir = join(demoRoot, "public", "engine");
const manifestPath = join(targetDir, "release.json");
const force = process.argv.includes("--force");

async function hasCachedRelease() {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await Promise.all(REQUIRED_FILES.map((file) => access(join(targetDir, file))));
    return manifest;
  } catch {
    return undefined;
  }
}

const cached = await hasCachedRelease();
if (cached && !force) {
  console.log(`StellarLatex ${cached.tagName} is already cached in public/engine.`);
  process.exit(0);
}

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "stellarlatex-vite-demo",
  "X-GitHub-Api-Version": "2022-11-28",
};

const releaseResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
  headers,
});
if (!releaseResponse.ok) {
  throw new Error(`GitHub release lookup failed (${releaseResponse.status}).`);
}

const release = await releaseResponse.json();
const asset = release.assets?.find((candidate) =>
  /^stellarlatex-v[\w.-]+\.zip$/i.test(candidate.name),
);
if (!asset) {
  throw new Error("The latest GitHub release does not contain a stellarlatex-v*.zip asset.");
}

console.log(`Downloading StellarLatex ${release.tag_name} from GitHub…`);
const archiveResponse = await fetch(asset.browser_download_url, { redirect: "follow" });
if (!archiveResponse.ok) {
  throw new Error(`GitHub asset download failed (${archiveResponse.status}).`);
}

const archive = new Uint8Array(await archiveResponse.arrayBuffer());
const entries = unzipSync(archive, {
  filter: ({ name }) => REQUIRED_FILES.includes(name),
});

await mkdir(targetDir, { recursive: true });
for (const file of REQUIRED_FILES) {
  const contents = entries[file];
  if (!contents) throw new Error(`The release archive is missing ${file}.`);
  const destination = join(targetDir, file);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      repository: REPOSITORY,
      tagName: release.tag_name,
      assetName: asset.name,
      browserDownloadUrl: asset.browser_download_url,
      digest: asset.digest ?? null,
      downloadedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
console.log(`StellarLatex ${release.tag_name} is ready in public/engine.`);
