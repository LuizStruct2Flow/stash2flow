-- The schema of the index and the ledger of slice 2 of FEATURE-001: sources,
-- assets with their text, baselines, runs. It holds what slice 2 needs and no
-- more. Applied by apply-schema.ts against the database of the configuration,
-- and by the contract suite, which creates and drops its own schema.

CREATE TABLE source (
  id TEXT PRIMARY KEY,
  location TEXT NOT NULL,
  account TEXT NOT NULL
);

CREATE TABLE asset (
  source_id TEXT NOT NULL REFERENCES source (id),
  source_asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  ext TEXT,
  pages INTEGER,
  source_link TEXT,
  text_layer_used BOOLEAN,
  listed_for_user_as_not_covered BOOLEAN,
  asset_date TEXT,
  asset_date_source TEXT,
  PRIMARY KEY (source_id, source_asset_id)
);

-- The OCR text of an asset, per page, kept as it was read.
CREATE TABLE asset_text (
  source_id TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (source_id, source_asset_id, page),
  FOREIGN KEY (source_id, source_asset_id) REFERENCES asset (source_id, source_asset_id)
);

CREATE TABLE baseline (
  source_id TEXT PRIMARY KEY REFERENCES source (id),
  assets BIGINT NOT NULL,
  bytes BIGINT NOT NULL
);

CREATE TABLE run (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source (id),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);
