"use client";

import { useState } from "react";

export function ProfileAvatar({
  displayName,
  src,
  className = "",
}: {
  displayName: string;
  src: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const initials =
    displayName
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0]?.toLocaleUpperCase())
      .join("") || "O";
  return (
    <span
      className={`profile-avatar ${className}`}
      aria-label={
        src && !broken ? `${displayName}'s avatar` : `${displayName}'s initials`
      }
      role="img"
    >
      {src && !broken ? (
        // Private same-origin delivery is deliberately not optimized into a public URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}

export function ProfileBanner({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="profile-banner" aria-hidden="true">
      {src && !broken ? (
        // Private same-origin delivery is deliberately not optimized into a public URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setBroken(true)} />
      ) : null}
    </div>
  );
}
