import { LocationIcon } from "@/components/icons";
import type { EntryPlace } from "@/lib/database/types";

const precisionLabels = {
  label_only: "Label only",
  approximate: "Approximate · about 3 km",
  exact: "Exact · private",
} as const;

export function PlaceCard({
  place,
  compact = false,
}: {
  place: EntryPlace;
  compact?: boolean;
}) {
  if (place.redacted_at) {
    return (
      <div className="place-card place-card-redacted" role="note">
        <LocationIcon className="size-5" />
        <span>Place removed from this revision for privacy.</span>
      </div>
    );
  }
  if (!place.place_name || !place.precision) return null;
  return (
    <div
      className={["place-card", compact ? "place-card-compact" : null]
        .filter(Boolean)
        .join(" ")}
    >
      <LocationIcon className="size-5" />
      <div>
        <strong>{place.place_name}</strong>
        {place.place_area || place.place_address ? (
          <span>
            {[place.place_area, place.place_address]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
        <small>{precisionLabels[place.precision]}</small>
      </div>
    </div>
  );
}
