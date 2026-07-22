"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";

import {
  maximumTagsPerRevision,
  normalizeTagComparison,
  tagLabelSchema,
} from "@/lib/validation/tag";
import { tagQueryValue } from "@/lib/tags/inline-hashtags";

type Suggestion = {
  tagId: string;
  displayName: string;
  normalizedName: string;
  activeUsage: number;
};

export function TagPicker({
  open,
  selected,
  csrfToken,
  onChange,
  onClose,
}: {
  open: boolean;
  selected: string[];
  csrfToken: string;
  onChange: (tags: string[]) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <TagPickerDialog
      selected={selected}
      csrfToken={csrfToken}
      onChange={onChange}
      onClose={onClose}
    />
  );
}

function TagPickerDialog({
  selected,
  csrfToken,
  onChange,
  onClose,
}: Omit<Parameters<typeof TagPicker>[0], "open">) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const requestSequence = useRef(0);
  const normalizedSelected = useMemo(
    () => new Set(selected.map(normalizeTagComparison)),
    [selected],
  );

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/tags/suggestions", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-odiina-csrf": csrfToken,
          },
          body: JSON.stringify({ prefix: tagQueryValue(query) }),
        });
        const result = (await response.json()) as {
          suggestions?: Suggestion[];
          message?: string;
        };
        if (!response.ok)
          throw new Error(result.message ?? "Suggestions failed.");
        if (sequence !== requestSequence.current) return;
        setSuggestions(result.suggestions ?? []);
        setError(null);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Tag suggestions are unavailable.",
        );
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [csrfToken, query]);

  function addTag(value: string) {
    const parsed = tagLabelSchema.safeParse(tagQueryValue(value));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Choose a valid tag.");
      return;
    }
    const normalized = normalizeTagComparison(parsed.data);
    if (normalizedSelected.has(normalized)) {
      setError(`“${parsed.data}” is already selected.`);
      return;
    }
    if (selected.length >= maximumTagsPerRevision) {
      setError("An Entry can have up to 10 tags.");
      return;
    }
    onChange([...selected, parsed.data]);
    setQuery("");
    setError(null);
    setAnnouncement(
      `${parsed.data} selected. ${selected.length + 1} of 10 tags.`,
    );
  }

  function removeTag(tag: string) {
    onChange(selected.filter((candidate) => candidate !== tag));
    setAnnouncement(`${tag} removed.`);
  }

  const cleanQuery = tagQueryValue(query);
  const canCreate =
    cleanQuery.length > 0 &&
    !normalizedSelected.has(normalizeTagComparison(cleanQuery)) &&
    !suggestions.some(
      (suggestion) =>
        suggestion.normalizedName === normalizeTagComparison(cleanQuery),
    );

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      className="modal-overlay"
    >
      <Modal className="tag-picker-modal">
        <Dialog
          aria-labelledby="tag-picker-heading"
          className="tag-picker-dialog"
        >
          {({ close }) => (
            <>
              <div className="tag-picker-header">
                <div>
                  <p className="eyebrow">Private organization</p>
                  <Heading id="tag-picker-heading" slot="title">
                    Add tags
                  </Heading>
                  <p>Tags classify this Entry. They never submit it.</p>
                </div>
                <Button className="button button-quiet" onPress={close}>
                  Done
                </Button>
              </div>

              <TextField
                value={query}
                onChange={setQuery}
                className="field-group"
                aria-describedby="tag-picker-help"
              >
                <Label>Find or create a tag</Label>
                <Input
                  autoFocus
                  maxLength={80}
                  placeholder="#work/oas"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const exact = suggestions.find(
                      (suggestion) =>
                        suggestion.normalizedName ===
                        normalizeTagComparison(cleanQuery),
                    );
                    if (
                      exact &&
                      !normalizedSelected.has(exact.normalizedName)
                    ) {
                      addTag(exact.displayName);
                    } else if (canCreate) {
                      addTag(cleanQuery);
                    }
                  }}
                />
              </TextField>
              <p id="tag-picker-help" className="field-help">
                Type # to find a tag; press Enter to select or create. Slash
                paths form private collections. 1–40 Unicode characters.{" "}
                {selected.length}/10 selected.
              </p>

              {selected.length ? (
                <section aria-labelledby="selected-tags-heading">
                  <div className="tag-picker-section-heading">
                    <Heading id="selected-tags-heading" level={3}>
                      Selected
                    </Heading>
                    <Button
                      className="text-button"
                      onPress={() => {
                        onChange([]);
                        setAnnouncement("All tags cleared.");
                      }}
                    >
                      Clear all
                    </Button>
                  </div>
                  <div className="tag-picker-selected">
                    {selected.map((tag) => (
                      <Button
                        key={normalizeTagComparison(tag)}
                        className="tag-chip tag-chip-remove"
                        onPress={() => removeTag(tag)}
                        aria-label={`Remove ${tag}`}
                      >
                        {tag} <span aria-hidden="true">×</span>
                      </Button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section aria-labelledby="suggested-tags-heading">
                <Heading id="suggested-tags-heading" level={3}>
                  {query ? "Matching private tags" : "Your recent tags"}
                </Heading>
                {loading ? <p role="status">Loading tag suggestions…</p> : null}
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {!loading && !error ? (
                  <div className="tag-suggestion-list">
                    {canCreate ? (
                      <Button
                        className="tag-suggestion"
                        onPress={() => addTag(cleanQuery)}
                      >
                        <strong>Create “{cleanQuery}”</strong>
                        <span>Private new tag</span>
                      </Button>
                    ) : null}
                    {suggestions
                      .filter(
                        (suggestion) =>
                          !normalizedSelected.has(suggestion.normalizedName),
                      )
                      .map((suggestion) => (
                        <Button
                          key={suggestion.tagId}
                          className="tag-suggestion"
                          onPress={() => addTag(suggestion.displayName)}
                        >
                          <strong>{suggestion.displayName}</strong>
                          <span>
                            {suggestion.activeUsage
                              ? `${suggestion.activeUsage} active ${suggestion.activeUsage === 1 ? "Entry" : "Entries"}`
                              : "Available from your private history"}
                          </span>
                        </Button>
                      ))}
                    {!canCreate && suggestions.length === 0 ? (
                      <p className="muted-state">
                        No existing tags yet. Type a name to create one.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
              <p className="sr-only" role="status" aria-live="polite">
                {announcement}
              </p>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
