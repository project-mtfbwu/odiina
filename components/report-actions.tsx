"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ReportShare } from "@/lib/reports/types";

export function ReportActions({
  reportId,
  csrfToken,
  shares,
  review,
}: {
  reportId: string;
  csrfToken: string;
  shares: ReportShare[];
  review: {
    title: string;
    period: string;
    introduction: string;
    reflection: string;
    aiNarrative: string;
    metrics: string[];
    moments: string[];
    places: string[];
  };
}) {
  const router = useRouter();
  const [reviewed, setReviewed] = useState(false);
  const [includePlaces, setIncludePlaces] = useState(false);
  const [days, setDays] = useState(7);
  const [shareUrl, setShareUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function publish() {
    setBusy(true);
    setMessage("");
    const expires = new Date(Date.now() + days * 86_400_000).toISOString();
    const response = await fetch(`/api/reports/${reportId}/share`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-odiina-csrf": csrfToken,
      },
      body: JSON.stringify({
        expiresAt: expires,
        includePlaces,
        includeMedia: false,
        clientRequestId: crypto.randomUUID(),
      }),
    });
    const value = (await response.json()) as {
      result?: { share_token: string };
      message?: string;
    };
    if (response.ok && value.result) {
      const url = `${window.location.origin}/s/${value.result.share_token}`;
      setShareUrl(url);
      setMessage(
        "Published snapshot created. Copy this link now; Odiina stores only its hash.",
      );
      router.refresh();
    } else setMessage(value.message ?? "Could not publish this snapshot.");
    setBusy(false);
  }

  async function revoke(id: string) {
    setBusy(true);
    await fetch(`/api/reports/shares/${id}/revoke`, {
      method: "POST",
      headers: { "x-odiina-csrf": csrfToken },
    });
    setMessage("Share revoked immediately.");
    setBusy(false);
    router.refresh();
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setMessage("Share link copied. It remains revocable and expiring.");
    } catch {
      setMessage("Copy was unavailable. Select the one-time link manually.");
    }
  }

  async function downloadMarkdown() {
    const response = await fetch(`/api/reports/${reportId}/export`, {
      method: "POST",
      headers: { "x-odiina-csrf": csrfToken },
    });
    if (!response.ok) {
      setMessage("Export could not be created.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = /filename="([a-z0-9._-]+)"/i.exec(disposition)?.[1];
    anchor.href = url;
    anchor.download = filename ?? "odiina-report.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-5">
      <section className="report-action-card" aria-labelledby="export-heading">
        <h2 id="export-heading">Export privately</h2>
        <p>
          Markdown omits media and coordinates. Print HTML uses your browser’s
          trusted print dialog; PDF quality depends on that browser and is not
          claimed as tagged PDF.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            className="button button-secondary"
            href={`/reports/${reportId}/print`}
            target="_blank"
            rel="noreferrer"
          >
            Open print view
          </a>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void downloadMarkdown()}
          >
            Download Markdown
          </button>
        </div>
      </section>
      <section className="report-action-card" aria-labelledby="share-heading">
        <h2 id="share-heading">Controlled text-only sharing</h2>
        <p>
          Every share is a new immutable snapshot. It contains no account IDs,
          Entry IDs, internal links, media, coordinates, Profile, private tags,
          or analytics.
        </p>
        <div className="share-review">
          <h3>Exact text snapshot preview</h3>
          <p>
            <strong>{review.title}</strong>
            <br />
            {review.period}
          </p>
          {review.introduction ? <p>{review.introduction}</p> : null}
          {review.aiNarrative ? (
            <div>
              <strong>AI-generated key moments</strong>
              <p>{review.aiNarrative}</p>
            </div>
          ) : null}
          {review.metrics.length ? (
            <div>
              <strong>At a glance</strong>
              <ul>
                {review.metrics.map((metric) => (
                  <li key={metric}>{metric}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <strong>Selected timeline</strong>
            {review.moments.length ? (
              <ul>
                {review.moments.map((moment, index) => (
                  <li key={index}>{moment}</li>
                ))}
              </ul>
            ) : (
              <p>No moments included.</p>
            )}
          </div>
          {review.reflection ? <p>{review.reflection}</p> : null}
          {includePlaces && review.places.length ? (
            <div>
              <strong>Included place labels</strong>
              <ul>
                {review.places.map((place) => (
                  <li key={place}>{place}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul>
            <li>Media excluded in this deployment</li>
            <li>Profile, private navigation and source identifiers excluded</li>
            <li>Viewers can still copy or screenshot shared content</li>
          </ul>
        </div>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={includePlaces}
            disabled={!review.places.length}
            onChange={(event) => setIncludePlaces(event.target.checked)}
          />
          <span>
            <strong>Include reviewed place labels</strong>
            <small>
              {review.places.length
                ? "Off by default. Home or Office labels can be sensitive."
                : "No visible selected place labels are available to publish."}
            </small>
          </span>
        </label>
        <label className="field">
          <span className="field-label">Expires after</span>
          <select
            className="input"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          <span>
            <strong>
              I reviewed the exact text, dates and place choice above
            </strong>
          </span>
        </label>
        <button
          className="button button-primary justify-self-start"
          type="button"
          disabled={!reviewed || busy}
          onClick={() => void publish()}
        >
          {busy ? "Publishing…" : "Publish revocable snapshot"}
        </button>
        {shareUrl ? (
          <div className="grid gap-2">
            <label className="field">
              <span className="field-label">One-time share link</span>
              <input
                className="input"
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <button
              className="button button-secondary justify-self-start"
              type="button"
              onClick={() => void copyShareLink()}
            >
              Copy share link
            </button>
          </div>
        ) : null}
        <p aria-live="polite">{message}</p>
        {shares.length ? (
          <div>
            <h3>Share management</h3>
            <p>
              Odiina stores only token hashes. Create a new reviewed snapshot to
              replace published content; an old link cannot be reconstructed
              after this page session.
            </p>
            <ul className="share-list">
              {shares.map((share) => (
                <li key={share.id}>
                  <span>
                    <strong>
                      {share.revoked_at
                        ? "Revoked"
                        : new Date(share.expires_at) <= new Date()
                          ? "Expired"
                          : "Active"}
                    </strong>
                    <small>
                      Token …{share.token_prefix} · expires{" "}
                      {new Date(share.expires_at).toLocaleString()} · version{" "}
                      {share.manifest_version}
                    </small>
                  </span>
                  {!share.revoked_at ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void revoke(share.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
