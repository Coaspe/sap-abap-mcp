import { readFileSync } from "node:fs"

/**
 * Read a text file with line endings normalised to LF.
 *
 * Assertions about published documents describe their content, not the
 * checkout's line-ending style. On a Windows checkout with `core.autocrlf=true`
 * the working tree holds CRLF while the repository holds LF, so an assertion
 * written against a literal newline would fail locally and pass in CI for no
 * substantive reason.
 *
 * Use this for every text document a test inspects. Binary assets must keep
 * using `readFileSync` without an encoding.
 */
export function readText(path: string): string {
  return readFileSync(path, "utf8").split("\r\n").join("\n")
}
