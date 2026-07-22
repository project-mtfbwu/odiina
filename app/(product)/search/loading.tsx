export default function SearchLoading() {
  return (
    <div className="content-column" role="status" aria-live="polite">
      <p className="eyebrow">Private recall</p>
      <h1 className="page-title">Searching your Odiina…</h1>
      <div className="skeleton-card" aria-hidden="true" />
    </div>
  );
}
