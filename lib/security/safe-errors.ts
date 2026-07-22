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
  odiina_video_upload_invalid:
    "Choose a WebM, MP4, M4V or MOV video up to 250 MiB.",
  odiina_voice_limit: "Each Entry revision can contain one voice note.",
  odiina_video_limit: "Each Entry revision can contain one video.",
  odiina_voice_video_conflict:
    "A standalone voice note and video cannot share one revision.",
  odiina_entry_media_limit:
    "An Entry can contain up to five photos and either one voice note or one video.",
  odiina_place_invalid:
    "Review the place name, privacy level and selected coordinates.",
  odiina_tag_invalid: "Use a tag with 1–40 characters and no controls.",
  odiina_tag_limit: "An Entry can have up to 10 tags.",
  odiina_tag_duplicate: "Remove the duplicate tag and try again.",
  odiina_search_invalid: "Check the private search filters and try again.",
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
