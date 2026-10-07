import { Given, Then, When } from '@cucumber/cucumber'
import { notBuilt } from '../support/not-built.ts'

Given(
  'a photo in a source of the location {string} with an album, a person, a favorite mark and a place',
  (_0: string) => notBuilt(),
)
Then('the album, the person, the favorite mark and the place are kept with the photo', () =>
  notBuilt(),
)
Given("a photo from the user's phone", () => notBuilt())
Then('the photo is whitelisted', () => notBuilt())
Given('a photo with the asset_date 2024-07-15', () => notBuilt())
Given('a photo with the asset_date 2024-08-15', () => notBuilt())
When('the user looks for photos of the month 2024-07', () => notBuilt())
Then('the answer has a match for the first photo only', () => notBuilt())
Given('a photo of a beach whose name says nothing about a beach', () => notBuilt())
When('the user looks for photos with the words {string}', (_0: string) => notBuilt())
Then('the answer has a match for the photo', () => notBuilt())
