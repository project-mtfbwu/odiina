"use client";

import { Button } from "react-aria-components";

export default function CalendarError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="panel status-card" role="alert">
      <h1>Calendar could not be loaded</h1>
      <p>
        Activity markers were not retained as current data. Your Entries have
        not been changed.
      </p>
      <Button className="button button-primary mt-4" onPress={reset}>
        Try Calendar again
      </Button>
    </section>
  );
}
