import { createHash } from "node:crypto"
import type { PublicDeclaration } from "./public-api.js"

/** Pure parser results only; callers must obtain currently authorized source first. */
export class PublicApiCache {
  private readonly entries = new Map<string, string>()
  private bytes = 0

  constructor(private readonly parse: (source: string, name: string) => PublicDeclaration[]) {}

  read(source: string, name: string): PublicDeclaration[] {
    const key = createHash("sha256").update(JSON.stringify([name.toUpperCase(), source])).digest("hex")
    const cached = this.entries.get(key)
    if (cached !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return JSON.parse(cached) as PublicDeclaration[]
    }
    const result = this.parse(source, name)
    const serialized = JSON.stringify(result)
    const bytes = Buffer.byteLength(serialized)
    if (bytes <= 128 * 1024) {
      this.entries.set(key, serialized)
      this.bytes += bytes
      while (this.entries.size > 32 || this.bytes > 1024 * 1024) {
        const oldest = this.entries.keys().next().value!
        this.bytes -= Buffer.byteLength(this.entries.get(oldest)!)
        this.entries.delete(oldest)
      }
    }
    return result
  }

  clear(): void { this.entries.clear(); this.bytes = 0 }
}
