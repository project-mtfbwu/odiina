export default function ProductLoading() {
  return (
    <div className="content-column" aria-busy="true" aria-live="polite">
      <p className="sr-only" role="status">
        Loading Odiina
      </p>
      <div className="skeleton mb-5 h-12 w-2/3 rounded-xl" aria-hidden="true" />
      <div className="panel grid gap-3 p-5" aria-hidden="true">
        <div className="skeleton h-4 w-1/3 rounded" />
        <div className="skeleton h-4 rounded" />
        <div className="skeleton h-4 w-5/6 rounded" />
      </div>
    </div>
  );
}
