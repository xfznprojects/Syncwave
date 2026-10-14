# Mix Mode — Feature Research & Implementation Reference

> **Status**: Research complete, not yet implemented.
> **Last updated**: 2026-02-26
> **Context**: User wants Spotify/Apple Music-style automix — crossfade between songs with matching BPM and key. This document captures all research findings and the planned architecture.

---

## 1. Audius API — Confirmed Capabilities (Live-Tested)

### BPM & Key Are Returned on Every Track

Tested against the live API (`api.audius.co/v1`) on 2026-02-26. Every track response includes:

| Field | Type | Example Values | Notes |
|---|---|---|---|
| `bpm` | float | `125`, `86`, `128.5` | Auto-detected via Essentia (C++ audio analysis lib) |
| `musical_key` | string | `"E minor"`, `"D minor"`, `"B flat major"` | Auto-detected via libKeyFinder |
| `is_custom_bpm` | bool | `false` | `true` if uploader manually overrode |
| `is_custom_musical_key` | bool | `false` | Same for key |
| `audio_analysis_error_count` | int | `0`, `1` | If >0, BPM/key data may be unreliable |

**These fields are NOT in the official v1 docs but ARE returned in practice.** Confirmed on both `/tracks/trending` and `/tracks/search` endpoints.

### Search Filtering by BPM and Key Works

```
GET /v1/tracks/search?query=electronic&bpm_min=120&bpm_max=130&key=E%20minor&limit=20&app_name=EXAMPLEAPP
```

Supported filter parameters for mix mode:
- `bpm_min` (string) — minimum BPM (inclusive)
- `bpm_max` (string) — maximum BPM (inclusive)
- `key` (string[]) — filter by musical key(s), e.g. `key=E%20minor`
- `genre` (string[]) — filter by genre(s)
- `mood` (string[]) — filter by mood(s)
- `sort_method` — `relevant`, `popular`, `recent`

### Key Format from API

The `musical_key` field uses human-readable strings:
- `"E minor"`, `"A minor"`, `"C major"`, `"B flat major"`, `"F sharp minor"`
- Uses "flat"/"sharp" words, not symbols
- Always `"<Note> <major|minor>"` format

### Other Useful Endpoints

| Endpoint | Use Case |
|---|---|
| `GET /tracks/search?bpm_min=X&bpm_max=Y&key=Z&genre=G` | Find compatible tracks (primary auto-fill) |
| `GET /tracks/trending?genre=G&time=week` | Fallback when search returns too few |
| `GET /tracks/recommended` | General recommendations, genre-filterable |
| `GET /tracks/{id}` | Full track metadata including BPM/key |

### What Audius Does NOT Have

- No "similar tracks" endpoint (given track X, find similar)
- No audio features endpoint (no energy, danceability, valence like Spotify)
- No beat grid / beat positions data
- No waveform data from API (must compute client-side)

---

## 2. Current Codebase Infrastructure

### What Already Exists (and can be reused)

| Component | File | What It Does | Relevance to Mix Mode |
|---|---|---|---|
| **BPM detection** | `js/analysis.js:134-184` | Autocorrelation-based real-time BPM from live audio | Useful as UI display; API data preferred for matching decisions |
| **Key detection** | `js/analysis.js:209-247` | Krumhansl-Kessler profile matching via chromagram | Same — UI display, API data for matching |
| **LUFS measurement** | `js/analysis.js:267-289` | Loudness approximation | Useful for volume normalization during crossfade |
| **Dynamic range** | `js/analysis.js:292-308` | Peak-to-RMS ratio | Can help detect quiet outros |
| **Energy computation** | `js/analysis.js:124-131` | RMS energy from time-domain data | Can trigger crossfade when energy drops in last 30s |
| **Web Audio graph** | `js/player.js:77-113` | AudioContext + AnalyserNode + ChannelSplitter | Foundation — needs GainNodes added |
| **Queue system** | `js/player.js` | Full queue: add/remove/reorder/shuffle/playNext | Needs mix-mode track selection logic |
| **Sync protocol** | `js/player.js:broadcastSync()` | Host broadcasts state every 3s via Supabase | Needs crossfade state fields added |
| **Deterministic sync** | `js/player.js:calculateDeterministicPosition()` | Hostless rooms compute position from timestamps | Crossfade can use same timestamp-based approach |
| **Track metadata** | `js/player.js:559-569` | Serializes id, title, user, artwork, duration, genre, mood, tags | Needs `bpm` and `musical_key` added |
| **Audius API wrapper** | `js/audius.js` | Search, trending, track fetch, stream URL | Needs BPM/key-filtered search function |

### What Does NOT Exist Yet

- No second audio element (only one `<audio>` currently)
- No `GainNode` in the audio graph (volume is set via `audio.volume` directly)
- No crossfade logic
- No preloading of next track
- No Camelot wheel / key compatibility mapping
- No auto-fill / radio mode
- No mix mode toggle UI
- `bpm` and `musical_key` not stored in queue track objects (the API returns them, but `serializeTrack()` doesn't include them)

### Current Audio Graph

```
MediaElementSource ──→ AnalyserNode (mono, fftSize=2048) ──→ audioContext.destination
                   └──→ ChannelSplitter ──→ AnalyserL (left channel, read-only)
                                         └──→ AnalyserR (right channel, read-only)
```

### Current Track Switch Flow (no transition)

```
1. audio.pause()
2. audio.src = getStreamUrl(newTrack.id)
3. audio.load()
4. startedAt = Date.now()
5. broadcastSync()   (host only)
6. audio.play()
```

### Current Sync Protocol Payload

```js
{
  trackId: currentTrack?.id,
  track: currentTrack,           // serialized track object
  startedAt: timestamp,          // when this track started (unix ms)
  currentTime: audio.currentTime,
  isPlaying: !audio.paused,
  queue: queue.map(serializeTrack),
  currentIndex: currentIndex,
}
```

---

## 3. Planned Architecture

### Dual Audio Element Crossfade Engine

```
Audio Element A ──→ MediaElementSource A ──→ GainNode A ──┐
                                                           ├──→ MergerNode ──→ AnalyserNode ──→ destination
Audio Element B ──→ MediaElementSource B ──→ GainNode B ──┘
```

Two audio elements swap roles:
- The "active" element plays the current track
- The "preload" element loads the next track ~30s before the current track ends
- At crossfade trigger, both play simultaneously while gains ramp in opposite directions
- After crossfade completes, roles swap

### Crossfade Trigger Logic

**Simple approach (no intro/outro detection needed):**

```
Trigger point = track.duration - CROSSFADE_LEAD_TIME (e.g., 15 seconds)
```

**Smarter approach (minimal extra code):**

Monitor energy level (already computed in analysis.js). When energy drops below a threshold in the last 30 seconds, that's likely the outro — start crossfade there. Falls back to the fixed trigger if energy doesn't drop.

```js
// Pseudocode
const timeRemaining = track.duration - audio.currentTime;
const isInOutroZone = timeRemaining < 30;
const energyDropped = currentEnergy < (averageEnergy * 0.4);

if (timeRemaining <= CROSSFADE_LEAD_TIME || (isInOutroZone && energyDropped)) {
  startCrossfade();
}
```

### Crossfade Execution

```js
// Linear crossfade over crossfadeDuration seconds
function updateCrossfade(elapsed, duration) {
  const progress = Math.min(1, elapsed / duration);
  gainA.gain.value = 1 - progress;  // fade out
  gainB.gain.value = progress;      // fade in

  if (progress >= 1) {
    completeCrossfade();  // stop A, swap roles
  }
}
```

The incoming track always starts from `0:00`. No need to find a "right moment" in the new track.

---

## 4. Camelot Wheel — Key Compatibility System

### Full Mapping Table

| Camelot | Key | Camelot | Key |
|---|---|---|---|
| 1A | Ab minor | 1B | B major |
| 2A | Eb minor | 2B | F# major |
| 3A | Bb minor | 3B | Db major |
| 4A | F minor | 4B | Ab major |
| 5A | C minor | 5B | Eb major |
| 6A | G minor | 6B | Bb major |
| 7A | D minor | 7B | F major |
| 8A | A minor | 8B | C major |
| 9A | E minor | 9B | G major |
| 10A | B minor | 10B | D major |
| 11A | F# minor | 11B | A major |
| 12A | Db minor | 12B | E major |

### API Key String → Camelot Code Mapping

The Audius API returns keys like `"E minor"`, `"B flat major"`. These need to be mapped:

```js
const KEY_TO_CAMELOT = {
  'A flat minor': '1A', 'B major': '1B',
  'E flat minor': '2A', 'F sharp major': '2B',
  'B flat minor': '3A', 'D flat major': '3B',
  'F minor': '4A',      'A flat major': '4B',
  'C minor': '5A',      'E flat major': '5B',
  'G minor': '6A',      'B flat major': '6B',
  'D minor': '7A',      'F major': '7B',
  'A minor': '8A',      'C major': '8B',
  'E minor': '9A',      'G major': '9B',
  'B minor': '10A',     'D major': '10B',
  'F sharp minor': '11A', 'A major': '11B',
  'D flat minor': '12A',  'E major': '12B',
};
```

### Compatibility Rules

```js
function getCompatibleCamelotCodes(camelotCode) {
  const num = parseInt(camelotCode);
  const letter = camelotCode.slice(-1);
  const other = letter === 'A' ? 'B' : 'A';
  const wrap = (n) => ((n - 1 + 12) % 12) + 1;

  return {
    perfect:  [`${num}${letter}`],                           // same key
    good:     [`${num}${other}`, `${wrap(num+1)}${letter}`, `${wrap(num-1)}${letter}`],  // relative major/minor, ±1
    okay:     [`${wrap(num+2)}${letter}`, `${wrap(num-2)}${letter}`],  // ±2
  };
}
```

### Compatibility Scores

| Relationship | Score | Example (from 9A / E minor) |
|---|---|---|
| Same code | 1.0 | 9A (E minor) |
| Relative major/minor | 0.9 | 9B (G major) |
| ±1 on wheel | 0.8 | 8A (A minor), 10A (B minor) |
| ±2 on wheel | 0.5 | 7A (D minor), 11A (F# minor) |
| Unrelated | 0.1 | Everything else |

---

## 5. Tiered Track Matching — "Never Lock Up" Strategy

When selecting the next track (from queue or auto-fill), use progressive relaxation:

| Tier | BPM Tolerance | Key Rule | Source | Score Multiplier |
|---|---|---|---|---|
| 1 | ±5% | Same Camelot or ±1 | Queue | 1.0 |
| 2 | ±10% | Any Camelot ±2 | Queue | 0.8 |
| 3 | ±15% | Ignore key | Queue | 0.6 |
| 4 | Any | Ignore key | Queue | 0.4 |
| 5 | ±5% | Same Camelot or ±1 | Audius search API | 1.0 |
| 6 | ±10% | Ignore key | Audius search API | 0.7 |
| 7 | Any | Any | Audius trending/recommended | 0.3 |

**Key principle**: Mix mode NEVER refuses to play. It always picks the best available option. A crossfaded transition between mismatched tracks still sounds better than a hard cut.

### Scoring Formula

```js
score = (bpmScore * 0.4) + (keyScore * 0.4) + (popularityScore * 0.2)

bpmScore     = 1 - Math.abs(candidate.bpm - current.bpm) / current.bpm
keyScore     = camelotCompatibilityScore(current.musical_key, candidate.musical_key)
popularityScore = Math.min(1, candidate.play_count / maxPlayCount)
```

---

## 6. Auto-Fill / Radio Mode

### Trigger Condition

When `queue.length - currentIndex < 3` (fewer than 3 tracks ahead), auto-fill kicks in.

### Search Waterfall

```
Step 1 (Strict):
  GET /tracks/search?genre={genre}&bpm_min={bpm*0.95}&bpm_max={bpm*1.05}&key={key}&limit=20

Step 2 (Relax key — try Camelot neighbors):
  Multiple searches with compatible keys from Camelot wheel

Step 3 (Relax BPM):
  GET /tracks/search?genre={genre}&bpm_min={bpm*0.88}&bpm_max={bpm*1.12}&limit=20

Step 4 (Genre only):
  GET /tracks/search?genre={genre}&limit=20&sort_method=popular

Step 5 (Trending fallback):
  GET /tracks/trending?genre={genre}&time=week&limit=20

Step 6 (Nuclear fallback):
  GET /tracks/trending?time=week&limit=20
```

Stop as soon as enough unplayed tracks are found.

### Deduplication

Keep a `Set<trackId>` of all tracks played or queued this session. Filter API results against it.

### Rate Limiting

- Max one auto-fill request per 30 seconds
- Cache search results for 5 minutes (same parameters likely return similar results)

### Who Controls Auto-Fill

- **Host rooms**: Only the host auto-fills. Queue changes broadcast to guests via existing sync.
- **Hostless rooms**: Designate one client as auto-fill coordinator, or have all clients run identical logic with same inputs for deterministic results.

### User Controls

- Toggle: "Auto-fill queue" on/off (default on when mix mode is enabled)
- Visual badge on auto-discovered tracks vs. manually added ones
- User can always manually add/remove/reorder — auto-fill only appends to end

---

## 7. Room Sync During Crossfades

### Approach: Deterministic Triggers

All clients independently know the crossfade rule:

```
crossfade starts at: track.duration - CROSSFADE_LEAD_TIME
```

Since existing sync keeps all clients within 500ms of the same position, they all hit the trigger at nearly the same time. No extra broadcast needed for crossfade start.

### Extended Sync Protocol

```js
broadcast('sync', {
  // existing fields
  trackId, track, startedAt, currentTime, isPlaying, queue, currentIndex,

  // new mix mode fields
  mixMode: true,
  crossfadeDuration: 12,          // seconds (configurable)
  nextTrack: { ... },             // pre-selected next track (null if not yet selected)
  nextTrackStartedAt: timestamp,  // when incoming track began playing (null if crossfade hasn't started)
});
```

### Edge Cases

| Scenario | Solution |
|---|---|
| Client joins mid-crossfade | Sync includes `nextTrack` + `nextTrackStartedAt`. Client calculates both positions and gain levels from timestamps. |
| Host skips during crossfade | Cancel crossfade immediately, hard-switch to new track, broadcast updated state. |
| Network lag → late fade start | Client computes where in the crossfade they *should* be and jumps to correct gain level. Timestamps make this deterministic. |
| Guest has slow connection | Worst case: slightly shorter crossfade heard. End state (Track B playing) still correct. |
| Track B fails to load | Cancel crossfade, let Track A finish, hard-switch to next available track. |

### State Machine

```
PLAYING → (trigger point reached) → PRELOADING → (next track buffered) → CROSSFADING → (fade complete) → PLAYING
                                                                            ↑                                 |
                                                                            └─────── (swap audio elements) ───┘
```

---

## 8. What's Feasible vs. Not

### Feasible (vanilla JS, no new dependencies)

- Dual audio element crossfade with GainNodes
- BPM-aware track selection using API data
- Camelot wheel key compatibility
- LUFS-based volume normalization during crossfade
- Auto-fill from Audius search API with progressive relaxation
- Deterministic room sync for crossfade timing
- Energy-based crossfade trigger (using existing analysis.js)

### Not Feasible (or not worth the effort)

- **Beat-phase-locked transitions** — requires precise beat grid, sub-ms timing
- **Pitch-preserving time-stretch** — `audio.playbackRate` changes pitch; real time-stretch needs a library like SoundTouch.js (~50KB) or Tone.js (large)
- **Phrase/structure detection** — AI/ML problem, no practical client-side solution
- **Gapless playback** — HTML audio elements have inherent gaps; would need AudioBuffer decoding (major rewrite)

### Could Do Later (with a library)

- **SoundTouch.js** for pitch-preserving tempo adjustment (~50KB WASM)
- **essentia.js** for more accurate BPM/key detection + beat positions (~1-3MB WASM)
- These could be loaded conditionally only when mix mode is active

---

## 9. Rough Implementation Order

1. **Store BPM/key in track objects** — Update `serializeTrack()` in player.js to include `bpm`, `musical_key`, `audio_analysis_error_count`
2. **Camelot wheel module** — Small utility: key string → Camelot code, compatibility checker, scoring function
3. **Dual audio engine** — Second `<audio>` element, GainNodes, crossfade ramp logic
4. **Mix mode track selection** — Score queue tracks by BPM + key, pick best next
5. **Crossfade trigger** — Timer-based + energy-based trigger in the playback loop
6. **Auto-fill** — Audius API search with waterfall + dedup + caching
7. **Sync protocol extension** — Add mix mode fields to broadcast
8. **UI** — Mix mode toggle, crossfade duration slider, visual indicators on queue

---

## 10. Files That Need Modification

| File | Changes |
|---|---|
| `js/player.js` | Dual audio elements, GainNodes, crossfade engine, updated serializeTrack, mix mode playNext logic |
| `js/audius.js` | New function: `searchCompatibleTracks(bpm, key, genre, options)` with waterfall |
| `js/analysis.js` | Export energy data for crossfade trigger; possibly expose a "is outro" detector |
| `js/app.js` | Mix mode toggle UI, crossfade settings, auto-fill coordinator, updated renderQueue |
| `js/room.js` | Extended sync protocol with mix mode fields |
| `js/config.js` | New config: `CROSSFADE_DURATION_S`, `CROSSFADE_LEAD_TIME_S`, `AUTOFILL_THRESHOLD`, `AUTOFILL_COOLDOWN_MS` |
| `index.html` | Mix mode toggle button, settings panel additions |
| `css/style.css` | Mix mode UI styling, auto-fill badge, crossfade progress indicator |
| **NEW: `js/camelot.js`** | Camelot wheel mapping, key compatibility scoring |
| **NEW: `js/mixmode.js`** | Mix mode coordinator: track scoring, auto-fill orchestration, crossfade state machine |

---

## 11. Reference: How Spotify & Apple Do It

### Spotify Automix (2025)
- Pre-analyzes BPM, key, and song structure server-side
- Reorders playlist for optimal BPM flow + Camelot compatibility
- Applies crossfades, beatmatching, and EQ fades in real time
- Time-stretches to align tempos
- Selects transition presets based on music characteristics

### Apple Music AutoMix (iOS 26)
- AI model for transition analysis
- Time-stretching and beat-matching
- Dynamically selects: silence removal, simple crossfade, or complex beat-matched transition
- Transitions at phrase boundaries rather than fixed durations
- Requires Apple Silicon

### What We're Building (SyncWave Mix Mode)
- BPM-aware track selection (API data, no analysis needed)
- Camelot key compatibility
- Simple volume crossfade (no beatmatching, no time-stretch)
- Energy-based crossfade trigger (good enough, no AI needed)
- Auto-fill from Audius search API
- Deterministic room sync
- **Result: 80% of the UX for 10% of the complexity**
