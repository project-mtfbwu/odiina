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
