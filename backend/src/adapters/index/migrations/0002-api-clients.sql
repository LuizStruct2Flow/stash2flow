-- The clients of the API and what the server keeps to recognise their
-- credentials (docs/concept/sources.md#credentials-of-the-apis-clients): a
-- digest of the credential, never the credential itself, with whether the
-- credential is withdrawn and when the client last called the API. It holds
-- what slice 2 needs and no more. Applied by apply-migrations.ts (through
-- apply-schema.ts) against the database of the configuration, and by the
-- contract suite, which creates and drops its own schema. IF NOT EXISTS, so a
-- database that already holds this migration but predates the recording is
-- adopted, not failed.

CREATE TABLE IF NOT EXISTS api_client (
  name TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
  last_called_at TIMESTAMPTZ
);
