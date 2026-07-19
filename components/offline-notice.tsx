"use client";

import { useEffect, useState } from "react";

export function OfflineNotice() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) {
    return null;
  }

  return (
    <div className="offline-banner" role="status">
      You are offline. Your private Feed remains on the server; reconnect before
      saving changes.
    </div>
  );
}
