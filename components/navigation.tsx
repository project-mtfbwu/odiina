"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  CalendarIcon,
  FeedIcon,
  PlusIcon,
  ProfileIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from "@/components/icons";
import { ProfileAvatar } from "@/components/profile-media";

const activeItems = [
  { href: "/feed", label: "Feed", icon: FeedIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/profile", label: "Profile", icon: ProfileIcon },
  { href: "/trash", label: "Trash", icon: TrashIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Navigation({
  csrfToken,
  displayName,
  handle,
  avatarUrl,
}: {
  csrfToken: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
}) {
  const pathname = usePathname();

  return (
    <>
      <header className="mobile-app-header md:hidden">
        <Link href="/feed" className="mobile-wordmark" aria-label="Odiina Feed">
          Odiina
        </Link>
        <div className="flex items-center gap-2">
          <span className="private-badge">Private timeline</span>
          <Link
            href="/search"
            className="composer-icon-button"
            aria-label="Search private Entries"
          >
            <SearchIcon className="size-5" />
          </Link>
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
          <ProfileAvatar
            displayName={displayName}
            src={avatarUrl}
            className="avatar-medium"
          />
          <div className="min-w-0">
            <p className="rail-profile-name">{displayName}</p>
            <p className="rail-profile-email">@{handle}</p>
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
        </nav>

        <div className="rail-footer">
          <Link className="capture-shortcut" href="/feed#capture-heading">
            <PlusIcon className="size-5" />
            Capture
          </Link>
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
        <Link className="mobile-capture-button" href="/feed#capture-heading">
          <PlusIcon className="size-6" />
          <span className="sr-only">Jump to capture composer</span>
        </Link>
        <Link
          href="/profile"
          className="mobile-nav-item"
          data-active={pathname.startsWith("/profile") || undefined}
          aria-current={pathname.startsWith("/profile") ? "page" : undefined}
        >
          <ProfileIcon className="size-5" />
          Profile
        </Link>
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
