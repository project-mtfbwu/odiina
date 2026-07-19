"use client";

import { useEffect } from "react";
import { Button } from "react-aria-components";

export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report only an opaque digest; Entry text must never reach browser logs.
    if (error.digest) {
      console.error("Odiina page error", { digest: error.digest });
    }
  }, [error.digest]);

  return (
    <div className="content-column">
      <section className="panel status-card" role="alert">
        <h1 className="text-xl font-bold">This page could not be loaded</h1>
        <p>
          Your private content was not changed. Check your connection and try
          again.
        </p>
        <Button className="button button-primary mt-5" onPress={reset}>
          Try again
        </Button>
      </section>
    </div>
  );
}
