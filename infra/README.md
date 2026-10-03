# infra

Local PostgreSQL 17 (pgvector image) for the media index, with the extensions
`vector`, `unaccent` and `pg_trgm` created on first start by `initdb/`.

It listens on loopback only (`127.0.0.1:5432`), not on the LAN.

    cp .env.example .env     # then set a real password (openssl rand -hex 24)
    docker compose up -d     # start
    docker compose ps        # check: status should be "healthy"
    docker compose down      # stop (data stays in the `pgdata` volume)

Init scripts run only on an empty data volume.

**Before indexing real documents:** the data volume must sit on an encrypted
disk.
