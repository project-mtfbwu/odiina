"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { TagCollection } from "@/lib/database/types";
import {
  buildTagCollectionTree,
  type TagCollectionNode,
} from "@/lib/tags/collections";

function CollectionItems({
  nodes,
  selected,
  selectedScope,
}: {
  nodes: TagCollectionNode[];
  selected: string | null;
  selectedScope: string | null;
}) {
  return (
    <ul className="tag-collection-list">
      {nodes.map((node) => {
        const collection = node.has_children;
        const active =
          selected === node.normalized_name &&
          selectedScope === (collection ? "collection" : "exact");
        const count = collection
          ? node.collection_entry_count
          : node.direct_entry_count;
        const query = new URLSearchParams({
          tag: node.display_name,
          sort: "newest",
        });
        if (collection) query.set("tagScope", "collection");
        return (
          <li key={node.normalized_name}>
            <Link
              href={`/search?${query}`}
              className="tag-collection-link"
              data-active={active || undefined}
              aria-current={active ? "page" : undefined}
              aria-label={`${node.label}, ${count} active ${count === 1 ? "Entry" : "Entries"}${collection ? ", collection including nested tags" : ""}`}
            >
              <span aria-hidden="true">#</span>
              <span>{node.label}</span>
              <span className="tag-collection-count" aria-hidden="true">
                {count}
              </span>
            </Link>
            {node.children.length ? (
              <CollectionItems
                nodes={node.children}
                selected={selected}
                selectedScope={selectedScope}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function TagCollections({
  collections,
  collapsible = false,
}: {
  collections: TagCollection[];
  collapsible?: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const selected =
    pathname === "/search" ? search.get("tag")?.toLocaleLowerCase("und") : null;
  const selectedScope =
    search.get("tagScope") === "collection" ? "collection" : "exact";
  const tree = buildTagCollectionTree(collections);
  const content = tree.length ? (
    <CollectionItems
      nodes={tree}
      selected={selected ?? null}
      selectedScope={selectedScope}
    />
  ) : (
    <p className="tag-collection-empty">Tags appear after you add one.</p>
  );

  if (!collapsible) return content;
  return (
    <details className="rail-tag-collections" open>
      <summary>Tags</summary>
      {content}
      <Link className="rail-tags-all" href="/tags">
        View all tags
      </Link>
    </details>
  );
}
