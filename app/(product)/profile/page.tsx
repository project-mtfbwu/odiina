import type { Metadata } from "next";
import Link from "next/link";

import { FragmentFocusRestorer } from "@/components/fragment-focus-restorer";
import { ProfileAvatar, ProfileBanner } from "@/components/profile-media";
import {
  getPrivateProfile,
  getProfileStatistics,
} from "@/lib/database/queries";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const [profile, statistics, params] = await Promise.all([
    getPrivateProfile(),
    getProfileStatistics(),
    searchParams,
  ]);
  const version = encodeURIComponent(profile.updated_at);
  const joined = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(profile.created_at));
  const stats = [
    { value: statistics.active_entries, label: "Active Entries" },
    { value: statistics.active_logging_days, label: "Logging days" },
    { value: statistics.current_month_entries, label: "This month" },
    { value: statistics.image_entries, label: "Image Entries" },
    { value: statistics.voice_entries, label: "Voice Entries" },
    { value: statistics.video_entries, label: "Video Entries" },
    { value: statistics.place_entries, label: "Place Entries" },
    { value: statistics.edited_entries, label: "Edited Entries" },
  ];
  return (
    <div className="profile-page">
      <FragmentFocusRestorer />
      <article className="profile-card" aria-labelledby="profile-heading">
        <ProfileBanner
          src={
            profile.banner_attachment_id
              ? `/api/profile/media/banner?v=${version}`
              : null
          }
        />
        <div className="profile-identity">
          <div className="profile-avatar-row">
            <ProfileAvatar
              displayName={profile.display_name}
              src={
                profile.avatar_attachment_id
                  ? `/api/profile/media/avatar?v=${version}`
                  : null
              }
              className="profile-avatar-large"
            />
            <Link
              className="button button-secondary profile-edit-button"
              href="/profile/edit"
              id="profile-edit-action"
            >
              Edit Profile
            </Link>
          </div>
          {params.saved === "1" ? (
            <p className="profile-success" role="status">
              Profile saved.
            </p>
          ) : null}
          <h1 id="profile-heading">{profile.display_name}</h1>
          <p className="profile-handle">@{profile.handle}</p>
          {profile.bio ? (
            <p className="profile-bio">{profile.bio}</p>
          ) : (
            <p className="profile-bio profile-bio-empty">
              Add a short private bio to make Odiina feel like yours.
            </p>
          )}
          <p className="profile-joined">Joined {joined}</p>
        </div>
        <section className="profile-stats" aria-labelledby="activity-heading">
          <div className="profile-section-heading">
            <div>
              <p className="eyebrow">Authorized activity</p>
              <h2 id="activity-heading">Your Odiina record</h2>
            </div>
            <span className="private-badge">Only you can see this</span>
          </div>
          <dl className="profile-stat-grid">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <p className="profile-stat-note">
            Counts use each active Entry’s current revision and occurrence date.
            Trash is excluded; restoring an Entry includes it again.
          </p>
        </section>
      </article>
    </div>
  );
}
