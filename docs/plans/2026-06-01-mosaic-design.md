# Mosaic — Design Document
*Multi-angle event video sharing platform*

---

## The Problem

Everyone has a camera, but there's no unified place to collect all footage from a single event. Event owners miss out on content captured by guests from different angles.

## Core Value

Give event owners a multi-angle view of their event — sourced from guests — with a timeline editor that lets them switch between angles at any point in time, and auto-generate a final video.

---

## Users

- **Event owner** — organizes the event, creates the room, manages media, edits the final video
- **Participant** — attends the event, uploads photos/videos from their phone

---

## Key Features

### For Participants (Mobile App)
- GPS-based event detection (Geofencing) → push notification "Event nearby — join?"
- QR code scan or invite link to join event
- At end of event: gallery picker showing only media from event timeframe
- User selects what to share → direct upload to R2/S3
- Full control — nothing uploads without explicit approval

### For Event Owners (Web Dashboard)
- Create event: name, date, location, duration
- Generate QR code + shareable invite link
- View all uploaded media in real time
- Auto-generated video draft when event ends
- Timeline editor: multi-angle per timestamp, drag & drop clips, add music, basic effects
- Export final video (rendered server-side with FFmpeg/Remotion)
- Share to social platforms

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────┐
│  Mobile App (React Native + Expo)                   │
│  Participants — GPS, gallery, selection, upload     │
└─────────────────┬───────────────────────────────────┘
                  │ REST / WebSocket
┌─────────────────▼───────────────────────────────────┐
│  Backend (Node.js + Express + PostgreSQL)           │
│  Events, users, media metadata, auth, job queue     │
└──────┬──────────────────────────┬───────────────────┘
       │ Signed URLs              │ FFmpeg/Remotion jobs
┌──────▼──────┐           ┌───────▼───────────────────┐
│  Storage    │           │  Web Dashboard (Next.js)  │
│  Cloudflare │           │  Event owner — edit, QR   │
│  R2         │           └───────────────────────────┘
└─────────────┘
```

### Data Model

```
Event
├── id, name, owner_id
├── start_time, end_time
├── location (lat/lng)
├── qr_code, invite_link
└── status (upcoming/live/ended)

EventParticipant
├── event_id, user_id
├── clock_delta (ms)        ← sync offset between device and server
└── joined_at

MediaItem
├── id, event_id, uploader_id
├── r2_key
├── raw_timestamp (EXIF)
├── synced_timestamp        ← raw_timestamp + clock_delta
├── type (photo/video)
├── duration
└── status (pending/approved/uploaded)

EditProject
├── event_id
├── timeline_json           ← full edit state as JSON
└── auto_generated (boolean)

TimelineClip (inside timeline_json)
├── synced_timestamp
├── duration
├── media_item_id
└── alternatives[]          ← all other media within ±3 seconds
```

---

## Clock Sync (Delta Sync)

Device clocks can differ by 2–3 seconds. On joining an event, the server records the delta between the device clock and server time. All media timestamps are corrected by this delta, aligning everything to a single timeline.

Future (V2): audio fingerprinting to sync clips by shared ambient sound.

---

## Video Pipeline

### Editing (Browser)
- Timeline UI built in React (using `@xzdarcy/react-timeline-editor` or custom)
- Every edit saves only `timeline_json` to DB — no rendering
- Preview: signed URLs streamed directly from R2, switched in JS

### Export (Server)
```
User clicks "Export"
        ↓
POST /api/export → BullMQ job created
        ↓
Worker downloads clips from R2
        ↓
Remotion/FFmpeg assembles:
  - clips in order with in/out points
  - audio mix (original + music track)
  - transitions / basic effects
        ↓
Final MP4 uploaded to R2
        ↓
Push notification → "Your video is ready"
```

### Auto-Generated Video
When event ends, a worker automatically:
1. Takes all approved MediaItems
2. Selects clips for variety (angle diversity, resolution, stability)
3. Builds `timeline_json`
4. Renders → owner receives draft

---

## Security

- **Auth**: Clerk (JWT + refresh tokens, Google/Apple login)
- **Media in transit**: HTTPS only, signed R2 URLs (15-minute TTL)
- **Direct upload**: phone → R2 directly, backend never touches raw files
- **API**: JWT middleware on all endpoints
- **Rate limiting + input validation** on all routes
- **CORS**: locked to known origins

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native + Expo |
| Web Dashboard | Next.js + TailwindCSS |
| Backend | Node.js + Express |
| Database | PostgreSQL (Neon) |
| Job Queue | Redis (Upstash) + BullMQ |
| Video Render | Remotion + FFmpeg |
| Storage | Cloudflare R2 |
| Auth | Clerk |
| Hosting | Railway or Render |
| Timeline UI | @xzdarcy/react-timeline-editor (OSS) |

---

## Monetization (Freemium)

- Free: upload, share, view
- Paid: download final video, extended storage, premium effects

---

## Roadmap

| Version | Scope |
|---------|-------|
| V1 | Event creation, QR/link join, media upload with approval, auto-generated video, basic timeline editor, export |
| V2 | Audio fingerprint sync, live streaming, social sharing (Instagram/TikTok) |
| V3 | Native mobile app for event owners with editing |

---

## Future Considerations (Out of Scope for V1)

- Live multi-angle streaming (owner selects active camera)
- Loyalty points system
- Automated hashtags for social platforms
- Location-based event discovery feed
