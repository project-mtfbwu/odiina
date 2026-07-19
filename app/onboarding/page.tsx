import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PreferencesForm } from "@/components/preferences-form";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { requireVerifiedUser } from "@/lib/auth/user";
import { getPreferences } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Confirm your timezone" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requireVerifiedUser();
  const [preferences, cookieStore] = await Promise.all([
    getPreferences(),
    cookies(),
  ]);

  if (preferences.iana_timezone) {
    redirect("/feed");
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main
        id="main-content"
        className="mx-auto flex min-h-dvh max-w-2xl items-center px-4 py-10 sm:px-8"
        tabIndex={-1}
      >
        <section
          className="panel w-full p-6 sm:p-10"
          aria-labelledby="onboarding-heading"
        >
          <p className="eyebrow">Welcome to Odiina</p>
          <h1 id="onboarding-heading" className="page-title">
            Confirm where your day happens.
          </h1>
          <p className="page-description mb-7">
            Odiina stores both the exact instant and the local civil day for
            every Entry. Your browser can suggest a timezone, but only you can
            confirm it.
          </p>
          <PreferencesForm
            initialTimezone={null}
            initialWeekStartsOn={preferences.week_starts_on}
            csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
            onboarding
          />
        </section>
      </main>
    </>
  );
}
