"use client";

import { Button } from "react-aria-components";

import { StatusCard } from "@/components/status-card";

export default function ProfileError({ reset }: { reset: () => void }) {
  return (
    <StatusCard
      title="Profile unavailable"
      action={
        <Button className="button button-primary" onPress={reset}>
          Try again
        </Button>
      }
    >
      Odiina could not load your private Profile.
    </StatusCard>
  );
}
