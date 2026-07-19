import Link from "next/link";

const primaryItems = [
  { href: "/feed", label: "Feed", marker: "F" },
  { href: "/trash", label: "Trash", marker: "T" },
  { href: "/settings", label: "Settings", marker: "S" },
];

export function Navigation({ email }: { email: string | null }) {
  return (
    <>
      <aside className="hidden min-h-dvh bg-[var(--rail)] text-white md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
        <div className="px-5 pt-7 pb-6">
          <Link
            href="/feed"
            className="inline-flex min-h-11 items-center text-xl font-black tracking-[-0.04em]"
            aria-label="Odiina Feed"
          >
            Odiina
          </Link>
          <p className="mt-1 text-xs font-semibold tracking-[0.12em] text-[var(--rail-muted)] uppercase">
            Private feed
          </p>
        </div>
        <nav aria-label="Primary" className="px-3">
          <ul className="m-0 grid list-none gap-1 p-0">
            {primaryItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-[#d8dae0] transition-colors hover:bg-white/8 hover:text-white"
                >
                  <span
                    className="grid h-7 w-7 place-items-center rounded-lg bg-white/8 text-xs text-[#b8aef5] group-hover:bg-white/12"
                    aria-hidden="true"
                  >
                    {item.marker}
                  </span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-7 border-t border-white/10 px-3 pt-5">
            <p className="mb-2 text-[0.68rem] font-bold tracking-[0.14em] text-[#7f8592] uppercase">
              Later
            </p>
            <p className="m-0 py-2 text-sm text-[#777d89]" aria-disabled="true">
              Interpretations
            </p>
            <p className="m-0 py-2 text-sm text-[#777d89]" aria-disabled="true">
              Reviews
            </p>
          </div>
        </nav>
        <div className="mt-auto border-t border-white/10 px-5 py-5">
          <p className="m-0 truncate text-xs text-[var(--rail-muted)]">
            {email ?? "Signed in"}
          </p>
        </div>
      </aside>

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-white/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
      >
        <ul className="m-0 grid list-none grid-cols-3 gap-1 p-0">
          {primaryItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-bold text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]"
              >
                <span aria-hidden="true" className="text-sm">
                  {item.marker}
                </span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
