import { readFile, writeFile } from "node:fs/promises"
import { summarizeUserOutcomes } from "../dist/src/user-outcomes.js"
const file = process.argv[2] ?? "docs/competitive-first-user-evidence-2026-10-02/scorecard.json"
const input = JSON.parse(await readFile(file, "utf8"))
const result = `${JSON.stringify(summarizeUserOutcomes(input.reports), null, 2)}\n`
// Explicit local export only. No network, raw observations, identifiers or attachments.
if (process.argv[3]) await writeFile(process.argv[3], result)
else process.stdout.write(result)
