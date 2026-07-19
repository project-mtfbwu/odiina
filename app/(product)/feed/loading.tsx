export default function FeedLoading() {
  return (
    <div
      className="content-column"
      aria-busy="true"
      aria-label="Loading your Odiina Feed"
    >
      <div className="skeleton mt-5 h-12 w-2/3 rounded-xl" />
      <div className="skeleton mt-4 h-28 rounded-[1.25rem]" />
      <div className="mt-6 grid gap-3">
        <div className="skeleton h-40 rounded-[1.25rem]" />
        <div className="skeleton h-48 rounded-[1.25rem]" />
        <div className="skeleton h-40 rounded-[1.25rem]" />
      </div>
    </div>
  );
}
