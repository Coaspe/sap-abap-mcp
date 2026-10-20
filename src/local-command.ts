import { dirname, resolve } from "node:path"
import readCmdShim from "read-cmd-shim"
import which from "which"

/** Resolve npm's Windows shims without a shell, including paths with spaces. */
export async function resolveLocalCommand(command: string, args: readonly string[]) {
  let executable = await which(command)
  let executableArgs = [...args]
  if (process.platform === "win32" && /\.cmd$/i.test(executable)) {
    const target = resolve(dirname(executable), await readCmdShim(executable))
    if (/\.[cm]?js$/i.test(target)) {
      executable = process.execPath
      executableArgs = [target, ...args]
    } else if (/\.(?:exe|com)$/i.test(target)) executable = target
    else throw new Error("Unsupported Windows command shim target")
  }
  return { command: executable, args: executableArgs }
}
