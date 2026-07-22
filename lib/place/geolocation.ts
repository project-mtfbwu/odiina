export type LocationFailure =
  | "insecure_context"
  | "unsupported"
  | "permission_denied"
  | "position_unavailable"
  | "timeout";

export class LocationLookupError extends Error {
  constructor(public readonly code: LocationFailure) {
    super(code);
  }
}

export type OneTimePosition = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
};

export function getOneTimePosition({
  secure = globalThis.isSecureContext,
  geolocation = globalThis.navigator?.geolocation,
  timeoutMs = 10_000,
}: {
  secure?: boolean;
  geolocation?: Geolocation;
  timeoutMs?: number;
} = {}): Promise<OneTimePosition> {
  if (!secure)
    return Promise.reject(new LocationLookupError("insecure_context"));
  if (!geolocation)
    return Promise.reject(new LocationLookupError("unsupported"));

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(accuracy) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          reject(new LocationLookupError("position_unavailable"));
          return;
        }
        resolve({ latitude, longitude, accuracyMeters: Math.max(0, accuracy) });
      },
      (error) => {
        const code =
          error.code === error.PERMISSION_DENIED
            ? "permission_denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "position_unavailable";
        reject(new LocationLookupError(code));
      },
      {
        enableHighAccuracy: false,
        maximumAge: 0,
        timeout: timeoutMs,
      },
    );
  });
}
