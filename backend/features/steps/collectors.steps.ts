import { Given, Then, When } from '@cucumber/cucumber'
import { notBuilt } from '../support/not-built.ts'

Given('two Macs whose collectors both fetch the same source', () => notBuilt())
When('both collectors send the asset records of the same asset', () => notBuilt())
Then('the index holds one row for the asset', () => notBuilt())
Given('a source fetched by a collector on one Mac', () => notBuilt())
When('a collector on a second Mac sends asset records for the same source', () => notBuilt())
Then('the same rows are updated', () => notBuilt())
Then('collected_by records which Mac sent them', () => notBuilt())
Given('a collector that reports one new asset and one changed asset', () => notBuilt())
When('the collector sends its asset records', () => notBuilt())
Then('the collector uploads the bytes of the new asset and of the changed asset', () => notBuilt())
Given(
  'a collector that sent a batch of asset records and was interrupted before the ledger acknowledged',
  () => notBuilt(),
)
When('the collector sends the same batch again', () => notBuilt())
Then('the index holds each asset once', () => notBuilt())
