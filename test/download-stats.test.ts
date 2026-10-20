import assert from "node:assert/strict"
import test from "node:test"
import { summarizeDownloads, utcDay } from "../src/download-stats.js"

test("UTC windows retain common zeros as suspected incompleteness without interpolation", () => {
  const days = Array.from({ length: 28 }, (_, i) => ({ day: new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10), downloads: i >= 22 && i <= 24 ? 0 : 10 }))
  const result = summarizeDownloads([...days, { day: "2026-10-19", downloads: 9999 }], { react: days, express: days }, "2026-10-18")
  assert.equal(result.rolling7.downloads, 40)
  assert.equal(result.rolling28.downloads, 250)
  assert.equal(result.rolling7.quality, "incomplete_suspected")
  assert.deepEqual(result.rolling7.commonZeroDays, ["2026-10-13", "2026-10-14", "2026-10-15"])
  assert.equal(result.fixedWeeks[0]?.start, "2026-09-21")
  assert.equal(result.fixedWeeks[0]?.end, "2026-09-27")
  assert.equal(result.observedEnd, "2026-10-18")
})

test("missing controls and isolated zeros cannot prove true zero or complete coverage", () => {
  const result = summarizeDownloads([{ day: "2026-10-18", downloads: 0 }], { react: [], express: [] }, "2026-10-18")
  assert.equal(result.rolling7.quality, "unknown")
  assert.equal(result.rolling7.observedDays, 1)
  assert.equal(result.rolling7.expectedDays, 7)
  assert.equal(result.fixedWeeks[0]?.fullCalendarWeekAvailable, false)
  assert.throws(() => utcDay("2026-02-30"))
})
