import type { TagCollection } from "@/lib/database/types";

export type TagCollectionNode = TagCollection & {
  label: string;
  children: TagCollectionNode[];
};

export function buildTagCollectionTree(
  collections: TagCollection[],
): TagCollectionNode[] {
  const nodes = new Map<string, TagCollectionNode>();
  for (const collection of collections) {
    nodes.set(collection.normalized_name, {
      ...collection,
      label:
        collection.display_name.split("/").at(-1) ?? collection.display_name,
      children: [],
    });
  }
  const roots: TagCollectionNode[] = [];
  for (const node of nodes.values()) {
    const separator = node.normalized_name.lastIndexOf("/");
    const parent =
      separator > 0
        ? nodes.get(node.normalized_name.slice(0, separator))
        : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: TagCollectionNode[]) => {
    items.sort((left, right) =>
      left.normalized_name.localeCompare(right.normalized_name, "und"),
    );
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}
