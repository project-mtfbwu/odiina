import { CalendarMonth } from "@/components/calendar-month";
import { LockIcon } from "@/components/icons";
import type { CalendarActivity } from "@/lib/database/types";

export function FeedContextRail({
  activity,
  selectedDate,
  today,
  weekStartsOn,
  timezone,
}: {
  activity: CalendarActivity[];
  selectedDate: string;
  today: string;
  weekStartsOn: number;
  timezone: string;
}) {
  return (
    <aside className="context-rail" aria-label="Feed context">
      <CalendarMonth
        selectedDate={selectedDate}
        today={today}
        weekStartsOn={weekStartsOn}
        activity={activity}
        compact
      />
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
