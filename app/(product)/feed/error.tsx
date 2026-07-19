"use client";

import { Button } from "react-aria-components";

export default function FeedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="content-column py-10">
      <section className="panel status-card" role="alert">
        <h1 className="text-xl font-bold">Your Feed could not be loaded</h1>
        <p>
          Your Entries have not been changed. Check your connection and try
          again.
        </p>
        <Button className="button button-primary mt-5" onPress={() => reset()}>
          Try again
        </Button>
      </section>
    </div>
  );
}
