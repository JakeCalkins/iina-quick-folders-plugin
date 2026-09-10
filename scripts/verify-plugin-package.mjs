import { spawnSync } from "node:child_process";
import { basename, posix, resolve } from "node:path";

const archive = resolve(process.argv[2] || "");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function unzip(args) {
  const result = spawnSync("unzip", args, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `Unable to inspect ${basename(archive)}`);
  }
  return result.stdout;
}

function normalizeManifestPath(value, field) {
  if (typeof value !== "string" || !value.trim()) fail(`Info.json requires a non-empty ${field}`);
  const normalized = posix.normalize(value);
  if (value.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    fail(`Info.json ${field} must stay inside the plugin root: ${value}`);
  }
  return normalized.replace(/^\.\//, "");
}

const entries = new Set(unzip(["-Z1", archive]).split(/\r?\n/).filter(Boolean));
if (!entries.has("Info.json")) {
  fail("Package must contain Info.json at the archive root; wrapper directories are not installable by IINA");
}

let manifest;
try {
  manifest = JSON.parse(unzip(["-p", archive, "Info.json"]));
} catch (error) {
  fail(`Package Info.json is invalid JSON: ${error.message}`);
}

for (const field of ["name", "identifier", "version", "entry"]) {
  if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
    fail(`Info.json requires a non-empty ${field}`);
  }
}
if (!manifest.author || typeof manifest.author.name !== "string" || !manifest.author.name.trim()) {
  fail("Info.json requires a non-empty author.name");
}
if (!/^([\w-_]+\.)+[\w-_]+$/.test(manifest.identifier)) {
  fail(`Info.json identifier is not a reverse-domain identifier: ${manifest.identifier}`);
}

const localPathFields = ["entry", "globalEntry", "preferencesPage", "helpPage"];
for (const field of localPathFields) {
  const value = manifest[field];
  if (value == null || (field === "helpPage" && /^https?:\/\//i.test(value))) continue;
  const path = normalizeManifestPath(value, field);
  if (!entries.has(path)) fail(`Info.json ${field} does not exist in the package: ${value}`);
}

console.log(`Verified IINA install layout for ${basename(archive)} (${manifest.name} ${manifest.version}).`);
