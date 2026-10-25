-- The clients of the API and what the server keeps to recognise their
-- credentials (docs/concept/sources.md#credentials-of-the-apis-clients): a
-- digest of the credential, never the credential itself, with whether the
-- credential is withdrawn and when the client last called the API. It holds
-- what slice 2 needs and no more. Applied by apply-schema.ts against the
-- database of the configuration, and by the contract suite, which creates and
-- drops its own schema.

CREATE TABLE api_client (
  name TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
  last_called_at TIMESTAMPTZ
);
