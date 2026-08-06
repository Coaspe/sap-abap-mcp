/**
 * Trailing-character trimming without a regular expression.
 *
 * A pattern anchored as `X+$` backtracks: on a string made of many repetitions
 * of `X` followed by a non-match, the engine retries from each start position
 * and the cost becomes quadratic in the input length. These helpers scan
 * backwards once, so the cost is linear and independent of the input's shape.
 */

function trimTrailingCodes(value: string, codes: readonly number[]): string {
  let end = value.length
  while (end > 0 && codes.includes(value.charCodeAt(end - 1))) end -= 1
  return end === value.length ? value : value.slice(0, end)
}

const SLASH = [0x2f]
const LINE_BREAKS = [0x0d, 0x0a]

/** Remove every trailing `/` so a base URL can be joined with a path. */
export function trimTrailingSlashes(value: string): string {
  return trimTrailingCodes(value, SLASH)
}

/** Remove every trailing CR or LF, as when reading a secret from stdin. */
export function trimTrailingLineBreaks(value: string): string {
  return trimTrailingCodes(value, LINE_BREAKS)
}
