import { AppError } from "./errors.js"
import { normalizeProfile, type ProfileStore, type SapProfileInput } from "./profile-store.js"
import type { SecretStore } from "./secret-store.js"

/** Persist a validated setup update; compensate if publishing the profile fails. */
export async function saveProfileCredential(profiles: ProfileStore, secrets: SecretStore, input: SapProfileInput, secret: string): Promise<void> {
  const { id } = normalizeProfile(input)
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
}
