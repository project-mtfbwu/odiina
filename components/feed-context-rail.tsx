import { CalendarIcon, LockIcon } from "@/components/icons";
import type { FeedDayGroup } from "@/lib/feed/grouping";

export function FeedContextRail({
  groups,
  timezone,
}: {
  groups: FeedDayGroup[];
  timezone: string;
}) {
  return (
    <aside className="context-rail" aria-label="Feed context">
      <section className="context-card">
        <div className="context-card-icon">
          <CalendarIcon className="size-5" />
        </div>
        <p className="eyebrow">This page</p>
        <h2>Recent days</h2>
        {groups.length ? (
          <ol className="context-days">
            {groups.slice(0, 5).map((group) => (
              <li key={group.localDate}>
                <span>
                  <strong>{group.label}</strong>
                  <small>{group.fullDate}</small>
                </span>
                <span className="context-count">{group.entries.length}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="context-copy">
            Your first captured moment will appear here.
          </p>
        )}
        <p className="context-note">
          Calendar navigation becomes interactive in MVP stage B.
        </p>
      </section>
      <section className="context-card context-private">
        <LockIcon className="size-5" />
        <div>
          <h2>Private by design</h2>
          <p>
            Your Feed is available only to your authenticated account. Times are
            grouped using {timezone}.
          </p>
        </div>
      </section>
    </aside>
  );
}
