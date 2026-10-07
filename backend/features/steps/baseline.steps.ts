import { Given, Then, When } from '@cucumber/cucumber'
import { notBuilt } from '../support/not-built.ts'

Given('a source holding 10 assets of 5000 bytes in all', () => notBuilt())
When('the first full run of the source finishes', () => notBuilt())
Then('the baseline of the source records 10 assets', () => notBuilt())
Then('the baseline of the source records 5000 bytes', () => notBuilt())
Given('a source whose first full run recorded its baseline', () => notBuilt())
Given('the source now holds more assets', () => notBuilt())
When('a later run of the source finishes', () => notBuilt())
Then('the baseline of the source is unchanged', () => notBuilt())
Given('a mailbox with 2 advertisements that are blacklisted and 3 other blacklisted assets', () =>
  notBuilt(),
)
When('the first full run of the mailbox finishes', () => notBuilt())
Then('the baseline of the source counts 5 blacklisted assets', () => notBuilt())
Given('a source holding 2 exact duplicates and 3 near duplicates', () => notBuilt())
Then('the baseline of the source counts 2 exact duplicates and 3 near duplicates', () => notBuilt())
Given('the same asset in 3 sources', () => notBuilt())
When('the first full run of each source finishes', () => notBuilt())
Then('the baseline records that the asset is found in 3 sources', () => notBuilt())
