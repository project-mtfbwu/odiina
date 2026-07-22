"use client";

import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";

import { LocationIcon } from "@/components/icons";
import {
  getOneTimePosition,
  LocationLookupError,
  type OneTimePosition,
} from "@/lib/place/geolocation";
import {
  approximateCoordinates,
  placeSnapshotSchema,
  type PlaceSnapshotInput,
} from "@/lib/validation/place";

type PermissionStage =
  "idle" | "explanation" | "requesting" | "found" | "error";

const lookupMessages: Record<string, string> = {
  insecure_context:
    "Current location requires a secure browser context. Manual entry still works.",
  unsupported:
    "This browser does not provide one-time location lookup. Enter a place manually.",
  permission_denied:
    "Location permission was denied or dismissed. Odiina will not ask again until you choose this action.",
  position_unavailable:
    "Your position is unavailable. Check device location settings or enter a place manually.",
  timeout:
    "The one-time location request timed out. You can retry or enter a place manually.",
};

export function PlacePicker(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selected: PlaceSnapshotInput | null;
  onSelect: (place: PlaceSnapshotInput) => void;
  onRemove: () => void;
}) {
  if (!props.isOpen) return null;
  return <OpenPlacePicker {...props} />;
}

function OpenPlacePicker({
  isOpen,
  onOpenChange,
  selected,
  onSelect,
  onRemove,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selected: PlaceSnapshotInput | null;
  onSelect: (place: PlaceSnapshotInput) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(selected?.placeName ?? "");
  const [area, setArea] = useState(
    selected?.placeArea ?? selected?.placeAddress ?? "",
  );
  const [precision, setPrecision] = useState<
    "label_only" | "approximate" | "exact"
  >(selected?.precision ?? "label_only");
  const [position, setPosition] = useState<OneTimePosition | null>(() =>
    selected?.latitude !== null &&
    selected?.latitude !== undefined &&
    selected.longitude !== null
      ? {
          latitude: selected.latitude,
          longitude: selected.longitude,
          accuracyMeters: selected.approximateRadiusMeters ?? 0,
        }
      : null,
  );
  const [permissionStage, setPermissionStage] = useState<PermissionStage>(
    selected?.latitude == null ? "idle" : "found",
  );
  const [lookupMessage, setLookupMessage] = useState("");
  const [exactConfirmed, setExactConfirmed] = useState(
    selected?.precision === "exact",
  );
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  function close() {
    setPosition(null);
    onOpenChange(false);
  }

  async function requestLocation() {
    setPermissionStage("requesting");
    setLookupMessage("Requesting one location fix…");
    setError("");
    try {
      const found = await getOneTimePosition();
      setPosition(found);
      setPermissionStage("found");
      setPrecision("approximate");
      setExactConfirmed(false);
      setName((current) => current || "Pinned location");
      setLookupMessage(
        found.accuracyMeters > 1_000
          ? "Location found with low accuracy. Approximate storage is recommended."
          : "Location found. Review the name and privacy level before attaching it.",
      );
      queueMicrotask(() => nameInput.current?.focus());
    } catch (caught) {
      const code =
        caught instanceof LocationLookupError
          ? caught.code
          : "position_unavailable";
      setPermissionStage("error");
      setLookupMessage(lookupMessages[code]);
    }
  }

  function save() {
    const coordinates =
      position && precision === "approximate"
        ? approximateCoordinates(position.latitude, position.longitude)
        : {
            latitude:
              position && precision === "exact" ? position.latitude : null,
            longitude:
              position && precision === "exact" ? position.longitude : null,
            approximateRadiusMeters: null,
          };
    const result = placeSnapshotSchema.safeParse({
      placeName: name,
      placeArea: area,
      placeAddress: null,
      ...coordinates,
      precision,
      source: position ? "device" : "manual",
      provider: null,
      providerPlaceId: null,
      countryCode: null,
      exactConfirmed,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Review this place.");
      return;
    }
    onSelect(result.data);
    close();
  }

  return (
    <ModalOverlay
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 backdrop-blur-[3px]"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
    >
      <Modal className="place-picker-modal">
        <Dialog className="outline-none" aria-label="Add a private place">
          <div className="place-picker-heading">
            <div>
              <p className="eyebrow">Optional private context</p>
              <Heading slot="title">Add a place</Heading>
            </div>
            <Button className="button button-secondary" onPress={close}>
              Cancel
            </Button>
          </div>

          <p className="place-picker-intro">
            A place describes where this Entry happened. Odiina never requests
            location unless you explicitly continue below.
          </p>

          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          <section
            className="place-picker-section"
            aria-labelledby="manual-place-heading"
          >
            <h3 id="manual-place-heading">Enter a place manually</h3>
            <TextField className="field" value={name} onChange={setName}>
              <Label className="field-label">Place name</Label>
              <Input
                ref={nameInput}
                className="input"
                maxLength={120}
                autoFocus
              />
              <p className="field-help">Required · 120 characters maximum</p>
            </TextField>
            <TextField className="field" value={area} onChange={setArea}>
              <Label className="field-label">Area or address (optional)</Label>
              <Input className="input" maxLength={240} />
            </TextField>
          </section>

          <section
            className="place-picker-section"
            aria-labelledby="current-location-heading"
          >
            <h3 id="current-location-heading">Use current location</h3>
            {permissionStage === "idle" || permissionStage === "error" ? (
              <Button
                className="button button-secondary"
                onPress={() => {
                  setPermissionStage("explanation");
                  setLookupMessage("");
                }}
              >
                <LocationIcon className="size-5" /> Use current location
              </Button>
            ) : null}
            {permissionStage === "explanation" ? (
              <div className="place-permission-explanation" role="note">
                <strong>One-time permission</strong>
                <p>
                  Your browser will request one location fix. No coordinate is
                  sent to a provider, stored, or attached until you review and
                  save it. Odiina never watches your movement.
                </p>
                <div className="place-picker-actions">
                  <Button
                    className="button button-primary"
                    onPress={requestLocation}
                  >
                    Continue
                  </Button>
                  <Button
                    className="button button-secondary"
                    onPress={() => setPermissionStage("idle")}
                  >
                    Not now
                  </Button>
                </div>
              </div>
            ) : null}
            {permissionStage === "requesting" ? (
              <p role="status">Requesting one location fix…</p>
            ) : null}
            {lookupMessage ? (
              <p className="place-lookup-status" role="status">
                {lookupMessage}
              </p>
            ) : null}
          </section>

          <section
            className="place-picker-section"
            aria-labelledby="search-heading"
          >
            <h3 id="search-heading">Search and nearby places</h3>
            <p className="provider-unavailable" role="status">
              Place search is unavailable because no production-approved
              provider is configured. Manual entry and one-time coordinate
              attachment remain available.
            </p>
          </section>

          <fieldset className="place-privacy-options">
            <legend>Location privacy</legend>
            <label>
              <input
                type="radio"
                name="place-precision"
                checked={precision === "label_only"}
                onChange={() => {
                  setPrecision("label_only");
                  setExactConfirmed(false);
                }}
              />
              <span>
                <strong>Label only</strong> · Store no coordinates.
              </span>
            </label>
            <label className={!position ? "place-option-disabled" : undefined}>
              <input
                type="radio"
                name="place-precision"
                disabled={!position}
                checked={precision === "approximate"}
                onChange={() => {
                  setPrecision("approximate");
                  setExactConfirmed(false);
                }}
              />
              <span>
                <strong>Approximate</strong> · Reduce locally to a 0.025° grid,
                shown as about 3 km.
              </span>
            </label>
            <label className={!position ? "place-option-disabled" : undefined}>
              <input
                type="radio"
                name="place-precision"
                disabled={!position}
                checked={precision === "exact"}
                onChange={() => {
                  setPrecision("exact");
                  setExactConfirmed(false);
                }}
              />
              <span>
                <strong>Exact</strong> · Store the selected coordinate
                privately.
              </span>
            </label>
          </fieldset>

          {precision === "exact" ? (
            <label className="exact-place-confirmation">
              <input
                type="checkbox"
                checked={exactConfirmed}
                onChange={(event) => setExactConfirmed(event.target.checked)}
              />
              I understand that this exact location will remain in private
              revision history until I use the separate all-history redaction.
            </label>
          ) : null}

          <div className="place-picker-footer">
            {selected ? (
              <Button
                className="button button-danger"
                onPress={() => {
                  onRemove();
                  close();
                }}
              >
                Remove current place
              </Button>
            ) : (
              <span />
            )}
            <Button
              className="button button-primary"
              onPress={save}
              isDisabled={
                !name.trim() || (precision === "exact" && !exactConfirmed)
              }
            >
              Attach place
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
