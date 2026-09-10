import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(repositoryRoot, "quick-folders.iinaplugin");
const failures = [];

function walk(directory, predicate) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path, predicate) : predicate(path) ? [path] : [];
  });
}

function fail(message) {
  failures.push(message);
}

function checkJavaScriptSyntax() {
  const files = walk(repositoryRoot, (path) => [".js", ".mjs"].includes(extname(path)));
  files.forEach((path) => {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    if (result.status !== 0) fail(`${relative(repositoryRoot, path)}: ${result.stderr.trim()}`);
  });
  return files.length;
}

function checkManifest() {
  const manifestPath = join(pluginRoot, "Info.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`quick-folders.iinaplugin/Info.json is invalid JSON: ${error.message}`);
    return;
  }

  ["name", "identifier", "version", "entry"].forEach((field) => {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) fail(`Info.json requires a non-empty ${field}`);
  });
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) fail("Info.json version must use semantic versioning (x.y.z)");
  if (!existsSync(join(pluginRoot, manifest.entry || ""))) fail(`Info.json entry does not exist: ${manifest.entry}`);
  if (typeof manifest.preferencesPage !== "string" || !existsSync(join(pluginRoot, manifest.preferencesPage))) {
    fail(`Info.json preferencesPage does not exist: ${manifest.preferencesPage}`);
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(manifest.ghRepo || "")) fail("Info.json ghRepo must use owner/repository format");
  if (!Number.isInteger(manifest.ghVersion) || manifest.ghVersion < 1) fail("Info.json ghVersion must be a positive integer");
  if (!Array.isArray(manifest.permissions)) fail("Info.json permissions must be an array");
  if (!manifest.preferenceDefaults || typeof manifest.preferenceDefaults !== "object") fail("Info.json requires preferenceDefaults");
}

function checkBrowserScripts() {
  const htmlPath = join(pluginRoot, "ui", "index.html");
  const html = readFileSync(htmlPath, "utf8");
  const assets = [
    ...Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi), (match) => match[1]),
    ...Array.from(html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi), (match) => match[1]),
  ];
  assets.filter((asset) => !/^[a-z]+:/i.test(asset)).forEach((asset) => {
    if (!existsSync(resolve(dirname(htmlPath), asset))) fail(`ui/index.html references missing asset: ${asset}`);
  });
}

function checkMarkdownLinks() {
  const files = walk(repositoryRoot, (path) => extname(path).toLowerCase() === ".md");
  files.forEach((path) => {
    const markdown = readFileSync(path, "utf8");
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, "").split("#", 1)[0];
      if (!target || /^(?:[a-z]+:|#)/i.test(target)) continue;
      target = decodeURIComponent(target);
      if (!existsSync(resolve(dirname(path), target))) fail(`${relative(repositoryRoot, path)} links to missing file: ${target}`);
    }
  });
  return files.length;
}

function checkAgentReferences() {
  const files = walk(repositoryRoot, (path) => basename(path) === "CLAUDE.md");
  files.forEach((path) => {
    if (readFileSync(path, "utf8").trim() !== "@AGENTS.md") {
      fail(`${relative(repositoryRoot, path)} must contain only @AGENTS.md`);
    }
    if (!existsSync(join(dirname(path), "AGENTS.md"))) {
      fail(`${relative(repositoryRoot, path)} has no sibling AGENTS.md`);
    }
  });
  return files.length;
}

function checkPrivacy() {
  const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".sh", ".yaml", ".yml"]);
  const textNames = new Set([".editorconfig", ".gitattributes", ".gitignore"]);
  const files = walk(repositoryRoot, (path) => textExtensions.has(extname(path)) || textNames.has(basename(path)));
  const forbidden = [
    [/(?:\/Users\/(?!example(?:\/|$)|demo(?:\/|$)|Shared(?:\/|$))[^/\s]+|\/home\/(?!example(?:\/|$))[^/\s]+)\//, "machine-specific home path"],
    [/\/private\/(?:tmp|var)\//, "machine-specific private temporary path"],
    [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, "private key"],
    [/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/, "GitHub token"],
    [/AKIA[0-9A-Z]{16}/, "AWS access key"],
    [/xox[baprs]-[A-Za-z0-9-]{20,}/, "Slack token"],
  ];

  files.forEach((path) => {
    readFileSync(path, "utf8").split(/\r?\n/).forEach((line, index) => {
      forbidden.forEach(([pattern, label]) => {
        if (pattern.test(line)) fail(`${relative(repositoryRoot, path)}:${index + 1} contains a possible ${label}`);
      });
    });
  });
}

const scriptCount = checkJavaScriptSyntax();
checkManifest();
checkBrowserScripts();
const markdownCount = checkMarkdownLinks();
const agentReferenceCount = checkAgentReferences();
checkPrivacy();

if (failures.length > 0) {
  failures.forEach((message) => console.error(`ERROR: ${message}`));
  process.exit(1);
}

console.log(`Validated ${scriptCount} JavaScript files, the plugin manifest, browser assets, ${markdownCount} Markdown files, ${agentReferenceCount} agent references, and privacy patterns.`);
