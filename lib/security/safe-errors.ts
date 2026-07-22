const safeErrorMap: Record<string, string> = {
  odiina_auth_required: "Please sign in again.",
  odiina_entry_unavailable: "That Entry is no longer available.",
  odiina_revision_conflict:
    "This Entry changed in another request. Reload it before editing again.",
  odiina_idempotency_conflict:
    "This request identifier was already used for different content.",
  odiina_occurrence_invalid: "Check the date, time and timezone.",
  odiina_entry_invalid: "Enter between 1 and 100,000 characters.",
  odiina_preferences_invalid: "Choose a valid timezone and week start.",
  odiina_profile_invalid: "Check the Profile fields and try again.",
  odiina_handle_unavailable: "That handle is unavailable. Choose another.",
  odiina_profile_media_unready:
    "Wait for the Profile image to finish processing, then try again.",
  odiina_image_upload_invalid:
    "Choose a JPEG, PNG, or WebP image up to 15 MiB.",
  odiina_audio_upload_invalid:
    "Choose WebM/Opus, Ogg/Opus, or M4A/AAC audio up to 25 MiB.",
  odiina_voice_limit: "Each Entry revision can contain one voice note.",
  odiina_entry_media_limit:
    "An Entry can contain up to five photos and one voice note.",
};

export function safeErrorMessage(code: string | undefined): string {
  if (!code) {
    return "Odiina could not complete that request. Try again.";
  }
  return (
    safeErrorMap[code] ??
    safeErrorMap[
      Object.keys(safeErrorMap).find((key) => code.includes(key)) ?? ""
    ] ??
    "Odiina could not complete that request. Try again."
  );
}
