CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  qr_code TEXT UNIQUE NOT NULL,
  invite_link TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','live','ended')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE event_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clock_delta_ms INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

CREATE TABLE media_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  raw_timestamp TIMESTAMPTZ,
  synced_timestamp TIMESTAMPTZ,
  type TEXT NOT NULL CHECK (type IN ('photo','video')),
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  file_size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE edit_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID UNIQUE NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  timeline_json JSONB NOT NULL DEFAULT '{"clips":[]}',
  auto_generated BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  r2_key TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_events_owner ON events(owner_id);
CREATE INDEX idx_events_location ON events(lat, lng);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_media_event ON media_items(event_id);
CREATE INDEX idx_media_synced_timestamp ON media_items(event_id, synced_timestamp);
CREATE INDEX idx_participants_event ON event_participants(event_id);
