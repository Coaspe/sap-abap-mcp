import { AppError } from "./errors.js"
import { normalizeProfile, type ProfileStore, type SapProfileInput } from "./profile-store.js"
import type { SecretStore } from "./secret-store.js"

const credentialUpdates = new WeakMap<SecretStore, Map<string, Promise<void>>>()

/** Serialize refresh and setup writes for a profile in the same local store. */
export async function withProfileCredentialUpdate(secrets: SecretStore, profileId: string, update: () => Promise<void>): Promise<void> {
  const id = profileId.trim().toUpperCase()
  let updates = credentialUpdates.get(secrets)
  if (!updates) {
    updates = new Map()
    credentialUpdates.set(secrets, updates)
  }
  const pending = (updates.get(id) ?? Promise.resolve()).catch(() => undefined).then(update)
  updates.set(id, pending)
  try {
    await pending
  } finally {
    if (updates.get(id) === pending) updates.delete(id)
    if (updates.size === 0) credentialUpdates.delete(secrets)
  }
}

/** Persist a validated setup update; compensate if publishing the profile fails. */
export async function saveProfileCredential(profiles: ProfileStore, secrets: SecretStore, input: SapProfileInput, secret: string): Promise<void> {
  const { id } = normalizeProfile(input)
  await withProfileCredentialUpdate(secrets, id, async () => {
    const previous = await secrets.get(id)
    await secrets.set(id, secret)
    try {
      await profiles.upsert(input)
    } catch (error) {
      try {
        if (previous === undefined) await secrets.delete(id)
        else await secrets.set(id, previous)
      } catch {
        throw new AppError("PROFILE_CREDENTIAL_RECOVERY_REQUIRED",
          "Profile save failed and the previous credential could not be restored. Re-enter the credential for the saved profile before using it.")
      }
      throw error
    }
  })
}
