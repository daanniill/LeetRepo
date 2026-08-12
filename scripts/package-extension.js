import { cp, mkdir, readFile, readdir, rm, utimes } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const dist = path.join(root, "dist");
const extension = path.join(dist, "extension");
const archive = path.join(dist, `leetrepo-extension-${manifest.version}.zip`);
const releaseTimestamp = new Date("2000-01-01T00:00:00.000Z");

async function normalizeTimestamps(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalizeTimestamps(target);
    await utimes(target, releaseTimestamp, releaseTimestamp);
  }
  await utimes(directory, releaseTimestamp, releaseTimestamp);
}

async function archiveEntries(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await archiveEntries(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

await rm(extension, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(extension, { recursive: true });

for (const entry of ["manifest.json", "src", "LICENSE", "PRIVACY.md", "TERMS.md"]) {
  await cp(path.join(root, entry), path.join(extension, entry), { recursive: true });
}
await mkdir(path.join(extension, "assets"), { recursive: true });
for (const icon of ["icon-16.png", "icon-32.png", "icon-48.png", "icon-128.png"]) {
  await cp(path.join(root, "assets", icon), path.join(extension, "assets", icon));
}

await normalizeTimestamps(extension);
const entries = await archiveEntries(extension);
const zipped = spawnSync("zip", ["-Xq", archive, ...entries], { cwd: extension, stdio: "inherit" });
if (zipped.error?.code === "ENOENT") throw new Error("The zip command is required to create the Chrome Web Store package.");
if (zipped.status !== 0) throw new Error(`zip exited with status ${zipped.status}.`);

process.stdout.write(`${archive}\n`);
