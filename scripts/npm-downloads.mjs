import { writeFile } from "node:fs/promises"
import { summarizeDownloads, utcDay } from "../dist/src/download-stats.js"

const options = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!["--package", "--start", "--end", "--output"].includes(key) || !value) throw new Error("Options: --package <name> --start <YYYY-MM-DD> --end <YYYY-MM-DD> --output <file.json>")
  options.set(key, value)
}
const name = options.get("--package") ?? "@coaspe/sap-abap-mcp"
const start = options.get("--start") ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
utcDay(start)
async function get(url) {
  const response = await fetch(url, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}`)
  return response.json()
}
const point = await get(`https://api.npmjs.org/downloads/point/last-day/${encodeURIComponent(name)}`)
utcDay(point.end)
const requestedEnd = options.get("--end") ?? point.end
utcDay(requestedEnd)
const end = requestedEnd < point.end ? requestedEnd : point.end
if (start > end) throw new Error("Start must not be after the last available day")
const controls = ["react", "express"].filter(value => value !== name)
const sources = await Promise.all([name, ...controls].map(async pkg => {
  const url = `https://api.npmjs.org/downloads/range/${start}:${end}/${encodeURIComponent(pkg)}`
  try {
    const result = await get(url)
    if (!Array.isArray(result.downloads) || result.downloads.some(row => !Number.isSafeInteger(row.downloads) || row.downloads < 0 || !Number.isFinite(utcDay(row.day)))) throw new Error("Invalid download data")
    return { name: pkg, url, status: "available", days: result.downloads }
  } catch (error) {
    if (pkg === name) throw error
    return { name: pkg, url, status: "unavailable", days: [] }
  }
}))
const registry = await get(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
const report = { observedAt: new Date().toISOString(), package: name, latest: registry["dist-tags"]?.latest,
  requestedStart: start, requestedEnd, availableEndFromPoint: point.end, queriedEnd: end,
  ...summarizeDownloads(sources[0].days, Object.fromEntries(sources.slice(1).map(source => [source.name, source.days])), point.end),
  releases: Object.entries(registry.time ?? {}).filter(([version]) => !["created", "modified"].includes(version))
    .map(([version, publishedAt]) => ({ version, publishedAt, gitHead: registry.versions?.[version]?.gitHead ?? null })),
  sources, interpretation: "Reported download events, not people, installations, activation or retention. Control packages are compared, never added to the package total. Re-run to requery recent data; no interpolation or zero correction is performed." }
if (options.has("--output")) await writeFile(options.get("--output"), `${JSON.stringify(report, null, 2)}\n`)
else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
