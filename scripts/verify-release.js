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
assert(!manifest.permissions.includes("identity"), "The local release must not request hosted OAuth identity access.");
assert(!manifest.host_permissions.some((value) => value === "<all_urls>" || value.includes("*://*")), "The release must not request broad host access.");
assert(manifest.content_scripts?.every((script) => script.matches.every((value) => /^https:\/\/(www\.)?leetcode\.com\/problems\/\*$/.test(value))), "Content scripts must remain limited to LeetCode problem pages.");
assert(!manifest.web_accessible_resources, "The release must not expose internal extension pages to websites.");

assert(manifest.host_permissions.includes("https://api.github.com/*"), "The release must allow the GitHub API.");
assert(manifest.optional_host_permissions?.includes("https://*/*"), "Custom HTTPS AI endpoints must be optional host permissions.");

await access(archive);
const files = await filesBelow(extension);
for (const required of ["manifest.json", "PRIVACY.md", "TERMS.md", "assets/icon-128.png", "src/background/service-worker.js", "src/core/llm.js"]) {
  assert(files.includes(required), `Release package is missing ${required}.`);
}
for (const forbidden of [".env", "server/", "tests/", "scripts/", "node_modules/"]) {
  assert(!files.some((file) => file === forbidden || file.startsWith(forbidden)), `Release package contains forbidden entry ${forbidden}.`);
}

for (const file of files.filter((value) => value.endsWith(".js"))) {
  const source = await readFile(path.join(extension, file), "utf8");
  assert(!/\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(\s*["']https?:\/\//.test(source), `${file} appears to execute remote or dynamic code.`);
}

process.stdout.write(`Release verified: ${files.length} packaged files, Manifest V${manifest.manifest_version}, local-only credential flow.\n`);
