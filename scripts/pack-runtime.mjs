import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveLocalCommand } from "../dist/src/local-command.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = resolve(process.argv[2] ?? join(root, "artifacts"))
const stage = await mkdtemp(join(tmpdir(), "sap-runtime-pack-"))
const npm = await resolveLocalCommand(process.platform === "win32" ? "npm.cmd" : "npm", [])
const runNpm = (args, cwd) => JSON.parse(execFileSync(npm.command, [...npm.args, "pack", "--ignore-scripts", "--json", ...args],
  { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }))
const removed = []
try {
  await mkdir(output, { recursive: true })
  const [original] = runNpm(["--pack-destination", stage], root)
  execFileSync("tar", ["-xzf", join(stage, original.filename), "-C", stage])
  const packageRoot = join(stage, "package")
  const manifestPath = join(packageRoot, "package.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  const worktreeDirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0
  manifest.sapAbapMcpBuild = { sourceCommit, worktreeDirty }
  if (!worktreeDirty) manifest.gitHead = sourceCommit
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  async function trim(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relative = path.slice(packageRoot.length + 1).replaceAll("\\", "/")
      const removable = relative.startsWith("node_modules/") &&
        (/\.map$/.test(entry.name) || /^node_modules\/(?:@[^/]+\/)?[^/]+\/(?:test|tests|__tests__|demo|demos|examples|bench|benchmarks|\.github)(?:\/|$)/.test(relative))
      if (removable) { removed.push(relative); await rm(path, { recursive: true, force: true }) }
      else if (entry.isDirectory()) await trim(path)
    }
  }
  await trim(join(packageRoot, "node_modules"))
  const [packed] = runNpm(["--pack-destination", output], packageRoot)
  const bytes = await readFile(join(output, packed.filename))
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
  const summary = { ...packed, files: undefined, path: join(output, packed.filename),
    compressedBytes: (await stat(join(output, packed.filename))).size, integrity,
    removedFilesOrDirectories: removed, licensesAndPatchedVendorPreserved: true }
  process.stdout.write(`${JSON.stringify([summary], null, 2)}\n`)
} finally { await rm(stage, { recursive: true, force: true }) }
