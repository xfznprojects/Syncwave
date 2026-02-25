<p align="center">
  <img src="https://img.shields.io/badge/Audius-7E1BCC?style=for-the-badge&logo=audius&logoColor=white" alt="Audius">
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase">
  <img src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js">
  <img src="https://img.shields.io/badge/Netlify-00C7B7?style=for-the-badge&logo=netlify&logoColor=white" alt="Netlify">
</p>

<h1 align="center">
  <br>
  SyncWave
  <br>
  <sub><sup>Social Listening Rooms for Audius</sup></sub>
</h1>

<p align="center">
  <b>Listen together. Stay in sync. No downloads.</b>
  <br>
  A real-time social listening platform where groups hear the same music at the same time — powered by the Audius music network.
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#tech-stack">Tech Stack</a> &bull;
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#deployment">Deployment</a> &bull;
  <a href="#247-rooms">24/7 Rooms</a>
</p>

---

## Features

### Synchronized Playback

- **Host Sync** — the room host broadcasts playback state every 3 seconds; listeners auto-correct drift exceeding 500ms
- **Deterministic Sync** — when no host is present (24/7 rooms or when the host leaves), all clients independently calculate the exact same playback position from a shared reference timestamp using math — no coordination needed
- **Seamless Handoff** — deterministic sync automatically defers when a live host is broadcasting, and resumes the instant the host disconnects

### Audio Analysis Engine

Real-time pro audio metrics displayed in the Analysis panel:

| Metric | Method |
|--------|--------|
| **BPM** | Energy envelope autocorrelation on a 20-second rolling buffer (30–200 BPM range) |
| **Key** | Chromagram from FFT bins correlated against 24 Krumhansl-Kessler profiles (major + minor) |
| **LUFS** | K-weighted loudness approximation on 3-second sliding windows |
| **DR** | Dynamic range from peak-to-RMS ratio |

### Dual Visualizers

- **3D Sphere** — Three.js wireframe sphere with vertex displacement driven by frequency data, particle system (800–2000 particles), orbital camera controls, and glow effects
- **2D Canvas** — three switchable modes:
  - **Bars** — frequency spectrum with cyan-to-magenta gradient and mirror reflection
  - **Wave** — smooth frequency waveform with gradient fill
  - **Circular** — radial 360-degree frequency display with center pulse

### Stereo Waveform

- Left and right audio channels rendered as mirrored waveforms (top = L, bottom = R)
- Frequency-based hue coloring (warm tones for bass, cool tones for highs)
- Click or drag to seek
- Zoom in/out (1.0x – 4.0x)

### Live Chat with GIFs

- Real-time messaging via Supabase Realtime broadcasts
- **GIF Picker** — Tenor API integration with search, trending tags, and grid preview
- Chat history persisted to Supabase (loads for late joiners)
- Full XSS sanitization on all incoming messages

### Anti-Spam & Moderation

- Rate limiting: 5 messages / 10s, 3 GIFs / 20s, 600ms minimum gap
- Duplicate detection (last 5 messages, 30-second window)
- Content rules: character spam, word repetition, excessive caps, link limits
- Escalating cooldowns: 2s → 5s → 15s → 30s → 60s
- Host tools: **mute**, **kick**, and **ban** users via right-click context menu

### Song Requests

- Non-host listeners can submit song requests
- Host sees a notification badge and can approve or reject each request
- Approved tracks are added directly to the queue

### Social Actions

- **Like**, **Repost**, and **Follow** — directly from the player bar
- Authenticated through a Netlify Function proxy (API secret never touches the browser)
- Visual state feedback (magenta heart, green repost, cyan follow)

### Queue Management

- Add tracks from search, URL, or requests
- Drag-to-reorder
- Shuffle mode
- Queue persists to Supabase

### Room Discovery

- **24/7 Rooms** — permanent broadcast rooms that always appear, with deterministic playback that loops continuously
- **Active Rooms** — sorted by listener count, updated in real-time via lobby broadcasts
- **Recent Rooms** — archived rooms sorted by last activity
- Room cards show host info, listener count, and currently playing track

### Search & Discovery

- **Trending** — weekly trending tracks from Audius
- **Search** — keyword search
- **URL Import** — paste any Audius track, playlist, or profile URL
- **My Tracks** — your own uploads (when logged in)
- **Favorites** — your liked tracks (when logged in)

### Authentication

- Audius OAuth popup flow — no passwords, no email
- JWT token decoded client-side
- Session persists in localStorage across refreshes
- Automatic popup close on successful login

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Music API** | [Audius](https://audius.co) — decentralized music streaming |
| **Realtime** | [Supabase Realtime](https://supabase.com) — presence, broadcasts, and database |
| **3D Graphics** | [Three.js](https://threejs.org) — WebGL audio-reactive visualizer |
| **GIFs** | [Tenor API](https://tenor.com) — search and trending GIFs |
| **Hosting** | [Netlify](https://netlify.com) — static hosting + serverless functions |
| **Audio** | Web Audio API — FFT analysis, stereo splitting, audio graph |
| **Font** | [JetBrains Mono](https://www.jetbrains.com/lp/mono/) via Google Fonts |

## Getting Started

### Prerequisites

- A [Supabase](https://supabase.com) project (free tier works)
- An [Audius Developer App](https://audius.co/settings/developer-apps) (API key + secret)
- A [Tenor API key](https://console.cloud.google.com) (for GIF search)
- [Node.js](https://nodejs.org) (for the build script)


## Deployment

### Netlify (Recommended)

1. Push to GitHub
2. Connect the repo in [Netlify](https://app.netlify.com)
3. Set environment variables in **Site Settings → Environment Variables**:
   - `AUDIUS_API_KEY`
   - `AUDIUS_API_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `TENOR_API_KEY`
4. Deploy — Netlify runs `node build.js` automatically

The `netlify.toml` is already configured:

```toml
[build]
  command = "node build.js"
  publish = "."
  functions = "netlify/functions"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```


## 24/7 Rooms

SyncWave supports permanent rooms that play continuously — even with zero listeners. The playlist loops forever using deterministic time-based calculation.


## License

This project was built for the [Audius Hackathon](https://audius.co). All music is streamed from the Audius network.

---
