"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";

import type { EntryMedia } from "@/lib/database/types";
import { formatVoiceDuration } from "@/lib/media/recorder";

const playbackEvent = "odiina:media-play";

export function VoicePlayer({
  media,
  trash = false,
  compact = false,
}: {
  media: EntryMedia[];
  trash?: boolean;
  compact?: boolean;
}) {
  const voice = media.find((item) => item.media_kind === "audio");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    function pauseAnother(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== voice?.attachment_id) audio?.pause();
    }
    window.addEventListener(playbackEvent, pauseAnother);
    return () => {
      window.removeEventListener(playbackEvent, pauseAnother);
      audio?.pause();
    };
  }, [voice?.attachment_id]);

  if (!voice) return null;
  const voiceId = voice.attachment_id;
  const durationSeconds = voice.duration_ms / 1000;
  const progress = durationSeconds > 0 ? position / durationSeconds : 0;

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    setFailed(false);
    try {
      if (audio.paused) {
        window.dispatchEvent(
          new CustomEvent(playbackEvent, { detail: voiceId }),
        );
        if (audio.ended || audio.currentTime >= durationSeconds - 0.05) {
          audio.currentTime = 0;
          setPosition(0);
        }
        await audio.play();
      } else {
        audio.pause();
      }
    } catch {
      setFailed(true);
      setPlaying(false);
    }
  }

  return (
    <section
      className={`voice-player ${compact ? "voice-player-compact" : ""}`}
      aria-label="Private voice note"
    >
      <audio
        ref={audioRef}
        src={`/api/media/${voice.attachment_id}${trash ? "?scope=trash" : ""}`}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(durationSeconds);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
      />
      <div className="voice-player-topline">
        <span className="voice-player-label">Voice note</span>
        <span>{formatVoiceDuration(voice.duration_ms)}</span>
      </div>
      <div className="voice-player-controls">
        <Button
          className="voice-play-button"
          onPress={() => void togglePlayback()}
          aria-label={
            playing ? "Pause private voice note" : "Play private voice note"
          }
        >
          {playing
            ? "Pause"
            : position >= durationSeconds - 0.05
              ? "Replay"
              : "Play"}
        </Button>
        <div className="voice-waveform" aria-hidden="true">
          {voice.waveform_peaks.map((peak, index) => (
            <span
              key={index}
              className={
                index / voice.waveform_peaks.length <= progress
                  ? "is-played"
                  : ""
              }
              style={{
                height: `${Math.max(12, Math.round((peak / 1000) * 100))}%`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="voice-seek-row">
        <span aria-hidden="true">{formatVoiceDuration(position * 1000)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(durationSeconds, 0.25)}
          step={0.01}
          value={Math.min(position, durationSeconds)}
          aria-label="Seek private voice note"
          aria-valuetext={`${formatVoiceDuration(position * 1000)} of ${formatVoiceDuration(voice.duration_ms)}`}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (audioRef.current) audioRef.current.currentTime = next;
            setPosition(next);
          }}
        />
        <Button
          className="voice-restart-button"
          onPress={() => {
            if (!audioRef.current) return;
            audioRef.current.currentTime = 0;
            setPosition(0);
          }}
        >
          Restart
        </Button>
      </div>
      {failed ? (
        <p className="voice-player-error" role="alert">
          Private playback is unavailable. Check your session and retry.
        </p>
      ) : null}
      <p className="sr-only">
        Waveform navigation aid. Use the seek slider for precise keyboard
        access.
      </p>
    </section>
  );
}
