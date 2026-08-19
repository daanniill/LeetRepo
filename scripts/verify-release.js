import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const extension = path.join(root, "dist", "extension");
const archive = path.join(root, "dist", `leetrepo-extension-${manifest.version}.zip`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

assert(manifest.manifest_version === 3, "The release must use Manifest V3.");
assert(!manifest.permissions.includes("tabs"), "The release must not request broad tabs access.");
assert(!manifest.permissions.includes("activeTab"), "The release must not request redundant activeTab access.");
assert(!manifest.host_permissions.some((value) => value === "<all_urls>" || value.includes("*://*")), "The release must not request broad host access.");
assert(manifest.content_scripts?.every((script) => script.matches.every((value) => /^https:\/\/(www\.)?leetcode\.com\/problems\/\*$/.test(value))), "Content scripts must remain limited to LeetCode problem pages.");
assert(!manifest.web_accessible_resources, "The release must not expose internal extension pages to websites.");

const configText = await readFile(path.join(root, "src", "config.js"), "utf8");
const apiMatch = configText.match(/LEETREPO_API_BASE_URL\s*=\s*"([^"]+)"/);
assert(apiMatch, "The public API origin could not be read from src/config.js.");
const apiOrigin = new URL(apiMatch[1]).origin;
assert(apiOrigin.startsWith("https://"), "The public API origin must use HTTPS.");
assert(manifest.host_permissions.includes(`${apiOrigin}/*`), "The manifest must allow exactly the configured API origin.");

await access(archive);
const files = await filesBelow(extension);
for (const required of ["manifest.json", "docs/policies/privacy.md", "docs/policies/terms.md", "assets/icon-128.png", "src/background/service-worker.js"]) {
  assert(files.includes(required), `Release package is missing ${required}.`);
}
for (const forbidden of [".env", "server/", "tests/", "scripts/", "node_modules/", "src/core/llm.js"]) {
  assert(!files.some((file) => file === forbidden || file.startsWith(forbidden)), `Release package contains forbidden entry ${forbidden}.`);
}

for (const file of files.filter((value) => value.endsWith(".js"))) {
  const source = await readFile(path.join(extension, file), "utf8");
  assert(!/\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(\s*["']https?:\/\//.test(source), `${file} appears to execute remote or dynamic code.`);
}

process.stdout.write(`Release verified: ${files.length} packaged files, Manifest V${manifest.manifest_version}, ${apiOrigin}.\n`);
