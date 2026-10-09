CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE endpoints (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_endpoints_application ON endpoints(application_id, active);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 120),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_application_created ON events(application_id, created_at DESC);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'retrying', 'failed', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  cycle_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (cycle_attempt_count >= 0),
  replay_count INTEGER NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  last_status_code INTEGER,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deliveries_event ON deliveries(event_id, created_at);
CREATE INDEX idx_deliveries_endpoint ON deliveries(endpoint_id, created_at DESC);
CREATE INDEX idx_deliveries_status_next ON deliveries(status, next_attempt_at);

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN (
    'timeout', 'dns', 'connection_refused', 'tls', 'http_4xx', 'http_5xx', 'rate_limited', 'invalid_url', 'unknown'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_id, attempt_number)
);
CREATE INDEX idx_attempts_delivery ON delivery_attempts(delivery_id, attempt_number);

CREATE TABLE idempotency_keys (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (application_id, key)
);

CREATE TABLE outbox (
  id BIGSERIAL PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_outbox_unpublished ON outbox(available_at, id) WHERE published_at IS NULL;
