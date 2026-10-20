export interface DownloadDay { day: string; downloads: number }
const DAY = 86_400_000
export function utcDay(value: string): number {
  const time = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error("Use a real UTC date in YYYY-MM-DD format")
  }
  return time
}
const date = (time: number) => new Date(time).toISOString().slice(0, 10)

export function summarizeDownloads(days: DownloadDay[], controls: Record<string, DownloadDay[]>, availableEnd: string) {
  const own = new Map(days.map(row => [row.day, row.downloads]))
  const controlMaps = Object.entries(controls).map(([name, rows]) => [name, new Map(rows.map(row => [row.day, row.downloads]))] as const)
  const available = utcDay(availableEnd)
  const validDays = days.filter(row => utcDay(row.day) <= available)
  if (!validDays.length) throw new Error("No observations are available for the requested period")
  const start = Math.min(...validDays.map(row => utcDay(row.day)))
  const end = Math.min(available, Math.max(...validDays.map(row => utcDay(row.day))))
  function window(first: number, last: number) {
    let downloads = 0, observedDays = 0
    const commonZeroDays: string[] = [], ownZeroDays: string[] = []
    for (let time = first; time <= last; time += DAY) {
      const day = date(time), count = own.get(day)
      if (count === undefined || time > available) continue
      downloads += count; observedDays++
      if (count === 0) {
        ownZeroDays.push(day)
        if (controlMaps.length >= 2 && controlMaps.every(([, data]) => data.get(day) === 0)) commonZeroDays.push(day)
      }
    }
    return { start: date(first), end: date(last), downloads, observedDays,
      expectedDays: Math.round((last - first) / DAY) + 1, ownZeroDays, commonZeroDays,
      quality: commonZeroDays.length ? "incomplete_suspected" : "unknown",
      zeroMeaning: "unknown: download APIs cannot establish whether zero means no requests or missing logs" }
  }
  const weekday = new Date(start).getUTCDay()
  const weeks = []
  for (let first = start - ((weekday + 6) % 7) * DAY; first <= end; first += 7 * DAY) {
    weeks.push({ ...window(first, first + 6 * DAY), fullCalendarWeekAvailable: first >= start && first + 6 * DAY <= end })
  }
  return { availableEnd, observedEnd: date(end), timezone: "UTC", interpolation: "none",
    rolling7: window(end - 6 * DAY, end), rolling28: window(end - 27 * DAY, end),
    fixedWeeks: weeks, controls: controlMaps.map(([name]) => name) }
}
