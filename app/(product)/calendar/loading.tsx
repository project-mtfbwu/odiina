export default function CalendarLoading() {
  return (
    <div className="calendar-page" aria-busy="true" aria-live="polite">
      <p className="eyebrow">Calendar</p>
      <h1 className="page-title">Loading month activity…</h1>
      <div className="panel skeleton mt-6 h-96" />
      <p className="sr-only">Loading selected-day Entries.</p>
    </div>
  );
}
