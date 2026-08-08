import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const dist = path.join(root, "dist");
const extension = path.join(dist, "extension");
const archive = path.join(dist, `leetrepo-extension-${manifest.version}.zip`);

await rm(extension, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(extension, { recursive: true });

for (const entry of ["manifest.json", "src", "LICENSE", "PRIVACY.md", "TERMS.md"]) {
  await cp(path.join(root, entry), path.join(extension, entry), { recursive: true });
}
await rm(path.join(extension, "src/core/llm.js"), { force: true });
await mkdir(path.join(extension, "assets"), { recursive: true });
for (const icon of ["icon-16.png", "icon-32.png", "icon-48.png", "icon-128.png"]) {
  await cp(path.join(root, "assets", icon), path.join(extension, "assets", icon));
}

const zipped = spawnSync("zip", ["-qr", archive, "."], { cwd: extension, stdio: "inherit" });
if (zipped.error?.code === "ENOENT") throw new Error("The zip command is required to create the Chrome Web Store package.");
if (zipped.status !== 0) throw new Error(`zip exited with status ${zipped.status}.`);

process.stdout.write(`${archive}\n`);
