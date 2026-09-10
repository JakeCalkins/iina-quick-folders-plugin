import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version || "")) {
  console.error("Usage: npm run release:prepare -- <major.minor.patch>");
  process.exit(1);
}

const manifestPath = join(repositoryRoot, "quick-folders.iinaplugin", "Info.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const currentParts = String(manifest.version || "").split(".").map(Number);
const nextParts = version.split(".").map(Number);
const isNewer = nextParts.some((part, index) => part > currentParts[index] && nextParts.slice(0, index).every((value, prior) => value === currentParts[prior]));
if (!isNewer) {
  console.error(`Release version ${version} must be newer than ${manifest.version}`);
  process.exit(1);
}

const changelogPath = join(repositoryRoot, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const unreleasedHeading = "## [Unreleased]\n";
if (!changelog.includes(unreleasedHeading)) {
  console.error("CHANGELOG.md does not contain an Unreleased section");
  process.exit(1);
}
if (changelog.includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md already contains a ${version} section`);
  process.exit(1);
}
const unreleasedContent = changelog
  .split(unreleasedHeading, 2)[1]
  .split(/^## /m, 1)[0];
if (!/^### /m.test(unreleasedContent) || unreleasedContent.includes("_No unreleased changes yet._")) {
  console.error("The Unreleased section has no categorized changes to publish");
  process.exit(1);
}

const today = new Date();
const date = process.env.RELEASE_DATE || [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");
const updatedChangelog = changelog.replace(
  unreleasedHeading,
  `${unreleasedHeading}\n_No unreleased changes yet._\n\n## [${version}] - ${date}\n`
);
// Write only after every precondition passes so a failed preparation cannot
// leave the manifest and changelog at different versions.
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(changelogPath, updatedChangelog);

console.log(`Prepared Quick Folders ${version}. Review the changelog, commit, and push tag v${version}.`);
