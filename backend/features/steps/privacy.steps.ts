import { Given, Then, When } from '@cucumber/cucumber'
import { notBuilt } from '../support/not-built.ts'

Given('an asset that goes through the pipeline', () => notBuilt())
When('every step that uses a model runs', () => notBuilt())
Then("each model runs inside the app's process or at a model server on the user's network", () =>
  notBuilt(),
)
Given('a source that the user has added', () => notBuilt())
When('the app stores the access it needs', () => notBuilt())
Then('the access is stored encrypted', () => notBuilt())
Then('every scope of the access is read-only', () => notBuilt())
Given('a source of the location {string}', (_0: string) => notBuilt())
When('the collector fetches the source', () => notBuilt())
Then('the photo library is reached only through osxphotos', () => notBuilt())
