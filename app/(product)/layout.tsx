import { cookies } from "next/headers";

import { Navigation } from "@/components/navigation";
import { OfflineNotice } from "@/components/offline-notice";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { requireVerifiedUser } from "@/lib/auth/user";
import { getPrivateProfile } from "@/lib/database/queries";

export const dynamic = "force-dynamic";

export default async function ProductLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireVerifiedUser();
  const profile = await getPrivateProfile();
  const csrf = (await cookies()).get(csrfCookieName)?.value ?? "";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <OfflineNotice />
      <div className="app-grid">
        <Navigation
          csrfToken={csrf}
          displayName={profile.display_name}
          handle={profile.handle}
          avatarUrl={
            profile.avatar_attachment_id
              ? `/api/profile/media/avatar?v=${encodeURIComponent(profile.updated_at)}`
              : null
          }
        />
        <main className="app-main" id="main-content" tabIndex={-1}>
          <input
            type="hidden"
            name="odiina-csrf-context"
            value={csrf}
            readOnly
          />
          {children}
        </main>
      </div>
    </>
  );
}
