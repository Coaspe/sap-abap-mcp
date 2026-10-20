import { readFile, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import readCmdShim from "read-cmd-shim"
import which from "which"

/** Resolve npm's Windows shims without a shell, including paths with spaces. */
export async function resolveLocalCommand(command: string, args: readonly string[]) {
  let executable = await which(command)
  let executableArgs = [...args]
  if (process.platform === "win32" && /\.cmd$/i.test(executable)) {
    let target: string
    try {
      target = resolve(dirname(executable), await readCmdShim(executable))
    } catch (error) {
      // Node's bundled npm/npx launchers use a CLI variable, rather than the
      // literal target recognized by cmd-shim. Match the owning npm copy so
      // custom wrappers are not silently bypassed.
      const name = basename(executable).toLowerCase().replace(/\.cmd$/, "")
      if ((error as NodeJS.ErrnoException).code !== "ENOTASHIM" || !["npm", "npx"].includes(name)) throw error
      const npmRoot = join(dirname(executable), "node_modules", "npm")
      try {
        const [wrapper, original, metadata] = await Promise.all([
          readFile(executable, "utf8"), readFile(join(npmRoot, "bin", `${name}.cmd`), "utf8"),
          readFile(join(npmRoot, "package.json"), "utf8")
        ])
        const normalized = (text: string) => text.replace(/\r\n/g, "\n").trimEnd()
        if (normalized(wrapper) !== normalized(original) || JSON.parse(metadata).name !== "npm") throw error
        target = join(npmRoot, "bin", `${name}-cli.js`)
        if (!(await stat(target)).isFile()) throw error
      } catch { throw error }
    }
    if (/\.[cm]?js$/i.test(target)) {
      executable = process.execPath
      executableArgs = [target, ...args]
    } else if (/\.(?:exe|com)$/i.test(target)) executable = target
    else throw new Error("Unsupported Windows command shim target")
  }
  return { command: executable, args: executableArgs }
}
