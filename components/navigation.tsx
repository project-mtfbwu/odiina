"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  CalendarIcon,
  FeedIcon,
  PlusIcon,
  ProfileIcon,
  SettingsIcon,
  TrashIcon,
} from "@/components/icons";

function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

const activeItems = [
  { href: "/feed", label: "Feed", icon: FeedIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/trash", label: "Trash", icon: TrashIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const stagedItems = [{ label: "Profile", stage: "C", icon: ProfileIcon }];

export function Navigation({
  csrfToken,
  displayName,
  email,
}: {
  csrfToken: string;
  displayName: string;
  email: string | null;
}) {
  const pathname = usePathname();
  const avatarInitials = initials(displayName) || "O";

  return (
    <>
      <header className="mobile-app-header md:hidden">
        <Link href="/feed" className="mobile-wordmark" aria-label="Odiina Feed">
          Odiina
        </Link>
        <div className="flex items-center gap-2">
          <span className="private-badge">Private timeline</span>
          <Link
            href="/trash"
            className="composer-icon-button"
            aria-label="Trash"
          >
            <TrashIcon className="size-5" />
          </Link>
        </div>
      </header>

      <aside className="desktop-rail">
        <div className="rail-brand">
          <Link href="/feed" className="rail-wordmark" aria-label="Odiina Feed">
            Odiina
          </Link>
          <p>Raw life, kept private.</p>
        </div>

        <div className="rail-profile">
          <div className="avatar avatar-medium" aria-hidden="true">
            {avatarInitials}
          </div>
          <div className="min-w-0">
            <p className="rail-profile-name">{displayName}</p>
            <p className="rail-profile-email">{email ?? "Signed in"}</p>
          </div>
        </div>

        <nav aria-label="Primary" className="rail-navigation">
          <ul>
            {activeItems.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                (item.href === "/feed" && pathname.startsWith("/entries/"));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="rail-nav-item"
                    data-active={active || undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="size-5" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="rail-stage">
            <p className="rail-section-label">Next MVP increments</p>
            {stagedItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  className="rail-nav-item rail-nav-staged"
                  aria-disabled="true"
                  key={item.label}
                >
                  <Icon className="size-5" />
                  <span>{item.label}</span>
                  <span className="stage-badge">Stage {item.stage}</span>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="rail-footer">
          <a className="capture-shortcut" href="#capture-heading">
            <PlusIcon className="size-5" />
            Capture
          </a>
          <form action="/auth/logout" method="post">
            <input type="hidden" name="csrf" value={csrfToken} />
            <button className="rail-logout" type="submit">
              Log out
            </button>
          </form>
        </div>
      </aside>

      <nav aria-label="Mobile primary" className="mobile-navigation md:hidden">
        <Link
          href="/feed"
          className="mobile-nav-item"
          data-active={pathname === "/feed" || undefined}
          aria-current={pathname === "/feed" ? "page" : undefined}
        >
          <FeedIcon className="size-5" />
          Feed
        </Link>
        <Link
          href="/calendar"
          className="mobile-nav-item"
          data-active={pathname === "/calendar" || undefined}
          aria-current={pathname === "/calendar" ? "page" : undefined}
        >
          <CalendarIcon className="size-5" />
          Calendar
        </Link>
        <a className="mobile-capture-button" href="#capture-heading">
          <PlusIcon className="size-6" />
          <span className="sr-only">Jump to capture composer</span>
        </a>
        <span className="mobile-nav-item" aria-disabled="true">
          <ProfileIcon className="size-5" />
          Profile
          <span className="sr-only">available in MVP stage C</span>
        </span>
        <Link
          href="/settings"
          className="mobile-nav-item"
          data-active={pathname === "/settings" || undefined}
          aria-current={pathname === "/settings" ? "page" : undefined}
        >
          <SettingsIcon className="size-5" />
          Settings
        </Link>
      </nav>
    </>
  );
}
