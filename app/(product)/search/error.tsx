"use client";

import { StatusCard } from "@/components/status-card";

export default function SearchError({ reset }: { reset: () => void }) {
  return (
    <StatusCard
      title="Private search is temporarily unavailable"
      action={
        <button className="button button-secondary" onClick={reset}>
          Try Search again
        </button>
      }
    >
      Your query and results were not shared. Try again when the connection or
      search index is available.
    </StatusCard>
  );
}
