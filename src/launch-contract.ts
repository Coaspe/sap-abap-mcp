import { readFileSync } from "node:fs"

const metadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string; version: string
}

export const STDIO_COMMAND = "serve"
export const PACKAGE_NAME = metadata.name
export const PACKAGE_VERSION = metadata.version

export interface StdioLaunch {
  command: string
  args: string[]
}

/** Pin updates explicitly; npm reuses its cache between launches. */
export function packageLaunch(
  platform: NodeJS.Platform = process.platform,
  version = PACKAGE_VERSION,
  serverArgs: string[] = [STDIO_COMMAND]
): StdioLaunch {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Use an exact package version, not a moving tag or range")
  }
  return { command: platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", `${PACKAGE_NAME}@${version}`, ...serverArgs] }
}

export function onboardLaunch(entryPoint: string, platform: NodeJS.Platform, serverArgs: string[]): StdioLaunch {
  // A maintained checkout is a deliberate development target. Published/npm-cache
  // installations use a version pin so removing that cache cannot break the path.
  return /[\\/]node_modules[\\/]/.test(entryPoint)
    ? packageLaunch(platform, PACKAGE_VERSION, serverArgs)
    : { command: "node", args: [entryPoint, ...serverArgs] }
}
