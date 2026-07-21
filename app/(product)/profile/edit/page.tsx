import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ProfileEditor } from "@/components/profile-editor";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getPrivateProfile } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Edit Profile" };
export const dynamic = "force-dynamic";

export default async function EditProfilePage() {
  const [profile, cookieStore] = await Promise.all([
    getPrivateProfile(),
    cookies(),
  ]);
  return (
    <div className="content-column profile-edit-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Private identity</p>
          <h1 className="page-title">Edit Profile</h1>
          <p className="page-description">
            Choose how your private Odiina space identifies you. Nothing here is
            public or discoverable.
          </p>
        </div>
      </header>
      <section className="panel p-5 sm:p-7" aria-label="Profile details">
        <ProfileEditor
          profile={profile}
          csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
        />
      </section>
    </div>
  );
}
