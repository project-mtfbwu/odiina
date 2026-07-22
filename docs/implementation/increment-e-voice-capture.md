# Increment E — private voice-note capture, processing and playback

Status: implemented for local certification.

## Capture and consent

The composer and Entry editor support one voice note per revision, with
optional text and up to five photos. A live-recording dialog explains the
privacy boundary before requesting microphone permission, and recording starts
only after a second explicit action. Cancel, permission failure, backgrounding,
device loss, route change and unmount release every media track. Background or
device interruption stops cleanly and preserves any usable local draft for
review. A native audio-file input remains available when MediaRecorder is
missing, blocked or unsuitable.

Users can play, seek, restart, discard, retake and approve the local recording.
Nothing uploads before Entry submission. The limit is one voice note, 25 MiB,
and 10 minutes; the server is authoritative and rejects clips shorter than
250 ms, over two channels, over 96 kHz, or outside the approved format matrix.

## Safe processing and privacy

Approved source combinations are WebM/Opus, Ogg/Opus and MP4/M4A with AAC.
The signed resumable upload lands in private quarantine. The existing narrow
worker identity and lease queue then enforce this sequence:

1. fail-closed ClamAV scan;
2. file signature, declared-type and extension agreement;
3. bounded FFprobe inspection with exactly one audio stream and no video;
4. deterministic FFmpeg transcoding to mono 48 kHz AAC-LC in M4A;
5. metadata-free playback probing and 96-point waveform derivation;
6. immutable original and playback upload;
7. atomic, lease-fenced acceptance.

FFmpeg and FFprobe run only in the pinned Debian worker image, with no shell,
network dependency or user-controlled command fragments. The container uses
the distro's GPLv2-or-later FFmpeg 5.1 build and its native AAC encoder; no
nonfree codec library is installed. Revisit the exact image digest, security
support window and license inventory before deployment.

Objects, filenames and storage paths never appear in the UI or logs. Odiina
does not transcribe, analyze, autoplay, publish, geotag or send voice content to
AI. The original is private and immutable. Browsers receive only the accepted
playback rendition through an authenticated `private, no-store` endpoint.

## Revisions, recovery and playback

Adding, replacing or removing voice creates a new immutable Entry revision;
historical media membership remains available in revision history. A failed
upload retains the local draft and already-ready attachments so retry does not
repeat completed work. Entry activation and revision commands keep their
idempotency and optimistic-concurrency protections.

Custom controls expose play/pause, elapsed and total time, a labelled seek
slider, a non-semantic waveform and text status. Starting one player pauses any
other Odiina voice player. Playback supports authorized byte ranges and honest
loading, unavailable and failure states. Trash preserves owner playback and
restore behavior; Profile Voice Entries counts only current accepted audio on
active Entries.

## Local worker and certification

Start Supabase and the scanner, bootstrap the non-human worker exactly as
documented for the image pipeline, then run the containerized worker:

```powershell
corepack pnpm supabase:start
corepack pnpm supabase:reset
corepack pnpm media:scanner
corepack pnpm media:worker:container
```

The codec and safety certification uses generated synthetic tones only:

```powershell
corepack pnpm test:audio
corepack pnpm test:db
```

Physical-device microphone permission, iOS Safari, Android Chromium,
background interruption, Bluetooth/device loss, 400% reflow and assistive
technology remain required human gates before release. Automated axe and
Playwright evidence does not replace that review.
