"use client";

import { useEffect, useRef, useState } from "react";

import type { EntryMedia } from "@/lib/database/types";
import { formatVideoDuration } from "@/lib/media/video-recorder";

const playbackEvent = "odiina:media-play";
const seekEvent = "odiina:media-seek";

export function VideoPlayer({
  media,
  trash = false,
  compact = false,
}: {
  media: EntryMedia[];
  trash?: boolean;
  compact?: boolean;
}) {
  const video = media.find((item) => item.media_kind === "video");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    function pauseAnother(event: Event) {
      if ((event as CustomEvent<string>).detail !== video?.attachment_id) {
        element?.pause();
      }
    }
    function pauseForPrivacy() {
      if (document.visibilityState === "hidden") element?.pause();
    }
    function seekToEvidence(event: Event) {
      const detail = (
        event as CustomEvent<{ attachmentId: string; seconds: number }>
      ).detail;
      if (detail.attachmentId !== video?.attachment_id || !element) return;
      element.currentTime = detail.seconds;
      window.dispatchEvent(
        new CustomEvent(playbackEvent, { detail: video.attachment_id }),
      );
      void element.play().catch(() => setFailed(true));
    }
    window.addEventListener(playbackEvent, pauseAnother);
    window.addEventListener(seekEvent, seekToEvidence);
    document.addEventListener("visibilitychange", pauseForPrivacy);
    return () => {
      window.removeEventListener(playbackEvent, pauseAnother);
      window.removeEventListener(seekEvent, seekToEvidence);
      document.removeEventListener("visibilitychange", pauseForPrivacy);
      element?.pause();
    };
  }, [video?.attachment_id]);

  if (!video) return null;
  const scope = trash ? "&scope=trash" : "";
  const playbackScope = trash ? "?scope=trash" : "";

  return (
    <section
      className={`video-player ${compact ? "video-player-compact" : ""}`}
      aria-label="Private video"
    >
      <div
        className="video-player-frame"
        style={{ aspectRatio: `${video.width} / ${video.height}` }}
      >
        <video
          ref={videoRef}
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          playsInline
          preload="none"
          poster={`/api/media/${video.attachment_id}?variant=poster${scope}`}
          src={`/api/media/${video.attachment_id}${playbackScope}`}
          onPlay={() => {
            setFailed(false);
            window.dispatchEvent(
              new CustomEvent(playbackEvent, { detail: video.attachment_id }),
            );
          }}
          onError={() => setFailed(true)}
          aria-label={`Private video, ${formatVideoDuration(video.duration_ms)}, ${video.has_audio ? "with audio" : "silent"}`}
        >
          Your browser does not support private video playback.
        </video>
        <span className="video-duration-badge" aria-hidden="true">
          {formatVideoDuration(video.duration_ms)}
        </span>
      </div>
      <p className="video-player-meta">
        {video.has_audio ? "Video with audio" : "Silent video"} · Private safe
        derivative
      </p>
      {failed ? (
        <p className="video-player-error" role="alert">
          Private video playback is unavailable. Check your session and retry.
        </p>
      ) : null}
      <p className="sr-only">
        Captions are not available for this private video. Optional Entry text
        may provide context.
      </p>
    </section>
  );
}
