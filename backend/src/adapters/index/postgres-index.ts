import type { ClientBase, QueryResultRow } from 'pg'
import type { Asset, AssetRecord } from '../../domain/asset.ts'
import type { Baseline, Source } from '../../domain/source.ts'
import type { Index } from '../../ports/index.ts'

/**
 * The index on PostgreSQL: the sources, the assets with their text, the
 * baselines. One client, set to the schema of the app; the contract suite
 * sets its own schema instead and drops it after.
 *
 * The text of an asset is kept as it was read, per page, and answered back
 * as it was kept. Matching the words of a search stays in the domain rule,
 * which the use-case applies over what this index answers.
 */
export class PostgresIndex implements Index {
  private readonly client: ClientBase

  constructor(client: ClientBase) {
    this.client = client
  }

  async keepSource(source: Source): Promise<void> {
    await this.client.query(
      `INSERT INTO source (id, location, account)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET location = EXCLUDED.location, account = EXCLUDED.account`,
      [source.id, source.location, source.account],
    )
  }

  async source(sourceId: string): Promise<Source | undefined> {
    const result = await this.client.query(
      `SELECT id, location, account FROM source WHERE id = $1`,
      [sourceId],
    )
    const row = result.rows[0] as SourceRow | undefined
    return row && { id: row.id, location: row.location, account: row.account }
  }

  async sources(): Promise<Source[]> {
    const result = await this.client.query(`SELECT id, location, account FROM source ORDER BY id`)
    return result.rows.map((row) => {
      const source = row as SourceRow
      return { id: source.id, location: source.location, account: source.account }
    })
  }

  async keepAsset(asset: AssetRecord): Promise<void> {
    const text = asset.ocrText ?? []
    // The asset and its text change together or not at all.
    await this.client.query('BEGIN')
    try {
      await this.client.query(
        `INSERT INTO asset (
           source_id, source_asset_id, name, size, sha256, ext, pages, source_link,
           text_layer_used, listed_for_user_as_not_covered, asset_date, asset_date_source
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (source_id, source_asset_id) DO UPDATE SET
           name = EXCLUDED.name,
           size = EXCLUDED.size,
           sha256 = EXCLUDED.sha256,
           ext = EXCLUDED.ext,
           pages = EXCLUDED.pages,
           source_link = EXCLUDED.source_link,
           text_layer_used = EXCLUDED.text_layer_used,
           listed_for_user_as_not_covered = EXCLUDED.listed_for_user_as_not_covered,
           asset_date = EXCLUDED.asset_date,
           asset_date_source = EXCLUDED.asset_date_source`,
        [
          asset.sourceId,
          asset.sourceAssetId,
          asset.name,
          asset.size,
          asset.sha256,
          asset.ext ?? null,
          asset.pages ?? null,
          asset.sourceLink ?? null,
          asset.textLayerUsed ?? null,
          asset.listedForUserAsNotCovered ?? null,
          asset.assetDate ?? null,
          asset.assetDateSource ?? null,
        ],
      )
      await this.client.query(
        `DELETE FROM asset_text WHERE source_id = $1 AND source_asset_id = $2`,
        [asset.sourceId, asset.sourceAssetId],
      )
      await this.client.query(
        `INSERT INTO asset_text (source_id, source_asset_id, page, text)
         SELECT $1, $2, page, text FROM unnest($3::integer[], $4::text[]) AS pages(page, text)`,
        [asset.sourceId, asset.sourceAssetId, text.map((_, page) => page + 1), text],
      )
      await this.client.query('COMMIT')
    } catch (error) {
      await this.client.query('ROLLBACK')
      throw error
    }
  }

  async assets(): Promise<Asset[]> {
    const result = await this.client.query(
      `SELECT a.source_id, a.source_asset_id, a.name, a.size, a.sha256, a.ext, a.pages,
              a.source_link, a.text_layer_used, a.listed_for_user_as_not_covered,
              a.asset_date, a.asset_date_source,
              t.page AS text_page, t.text AS text_value
       FROM asset a
       LEFT JOIN asset_text t
         ON t.source_id = a.source_id AND t.source_asset_id = a.source_asset_id
       ORDER BY a.source_id, a.source_asset_id, t.page`,
    )
    const byIdentity = new Map<string, Asset>()
    for (const raw of result.rows) {
      const row = raw as AssetRow
      const identity = `${row.source_id}:${row.source_asset_id}`
      let asset = byIdentity.get(identity)
      if (!asset) {
        asset = assetFromRow(row)
        byIdentity.set(identity, asset)
      }
      if (row.text_page !== null) {
        const text = asset.ocrText ?? []
        text[row.text_page - 1] = row.text_value ?? ''
        asset.ocrText = text
      }
    }
    return [...byIdentity.values()]
  }

  async keepBaseline(sourceId: string, baseline: Baseline): Promise<void> {
    await this.client.query(
      `INSERT INTO baseline (source_id, assets, bytes)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_id) DO UPDATE SET assets = EXCLUDED.assets, bytes = EXCLUDED.bytes`,
      [sourceId, baseline.assets, baseline.bytes],
    )
  }

  async baseline(sourceId: string): Promise<Baseline | undefined> {
    const result = await this.client.query(
      `SELECT assets, bytes FROM baseline WHERE source_id = $1`,
      [sourceId],
    )
    const row = result.rows[0] as BaselineRow | undefined
    return row && { assets: Number(row.assets), bytes: Number(row.bytes) }
  }
}

interface SourceRow extends QueryResultRow {
  id: string
  location: string
  account: string
}

interface AssetRow extends QueryResultRow {
  source_id: string
  source_asset_id: string
  name: string
  size: string | number
  sha256: string
  ext: string | null
  pages: number | null
  source_link: string | null
  text_layer_used: boolean | null
  listed_for_user_as_not_covered: boolean | null
  asset_date: string | null
  asset_date_source: string | null
  text_page: number | null
  text_value: string | null
}

interface BaselineRow extends QueryResultRow {
  assets: string | number
  bytes: string | number
}

function assetFromRow(row: AssetRow): Asset {
  const asset: Asset = {
    sourceId: row.source_id,
    sourceAssetId: row.source_asset_id,
    name: row.name,
    size: Number(row.size),
    sha256: row.sha256,
  }
  if (row.ext !== null) asset.ext = row.ext
  if (row.pages !== null) asset.pages = row.pages
  if (row.source_link !== null) asset.sourceLink = row.source_link
  if (row.text_layer_used !== null) asset.textLayerUsed = row.text_layer_used
  if (row.listed_for_user_as_not_covered === true) asset.listedForUserAsNotCovered = true
  if (row.asset_date !== null) asset.assetDate = row.asset_date
  if (row.asset_date_source !== null) asset.assetDateSource = row.asset_date_source
  return asset
}
