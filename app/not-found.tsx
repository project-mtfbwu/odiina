import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-5">
      <section className="panel w-full p-8 text-center">
        <p className="eyebrow">Not found</p>
        <h1 className="page-title">That Odiina page is not available.</h1>
        <p className="page-description">
          It may have moved, or you may not have access to it.
        </p>
        <Link className="button button-primary mt-5" href="/feed">
          Return to Feed
        </Link>
      </section>
    </main>
  );
}
