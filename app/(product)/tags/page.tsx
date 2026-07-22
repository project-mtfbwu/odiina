import type { Metadata } from "next";
import Link from "next/link";

import { TagCollections } from "@/components/tag-collections";
import { getTagCollections } from "@/lib/database/queries";

export const metadata: Metadata = {
  title: "Tags",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const collections = await getTagCollections();
  return (
    <div className="content-column tags-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Private collections</p>
          <h1 className="page-title">Tags</h1>
          <p className="page-description">
            Browse current active Entries by your private tags. Nested paths
            such as #work/oas stay one tag and appear inside their parent
            collection.
          </p>
        </div>
        <Link className="button button-secondary" href="/search">
          Advanced Search
        </Link>
      </header>
      <section className="panel tag-collections-page" aria-label="Your tags">
        <TagCollections collections={collections} />
      </section>
    </div>
  );
}
