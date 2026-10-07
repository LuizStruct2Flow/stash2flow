import { Given, Then, When } from '@cucumber/cucumber'
import { notBuilt } from '../support/not-built.ts'

Given('the same bytes in an asset of one source and an asset of another source', () => notBuilt())
When('the assets are grouped', () => notBuilt())
Then('the two assets are in one duplicate group', () => notBuilt())
Then('the group is exact', () => notBuilt())
Given('a PDF that is an attachment of an e-mail', () => notBuilt())
Given('the same PDF in a source of the location {string}', (_0: string) => notBuilt())
Then(
  'the attachment and the asset in the source of the location {string} are in one exact group',
  (_0: string) => notBuilt(),
)
Given('the same bytes in a source of the location {string} and in its copy', (_0: string) =>
  notBuilt(),
)
Given('the user ranks the copy above the network folder in the order of sources', () => notBuilt())
Then('the two assets are exact duplicates', () => notBuilt())
Then('the keeper is the asset of the copy', () => notBuilt())
Given('a video in a source whose videos are not fetched', () => notBuilt())
Given('the same video at another provider', () => notBuilt())
Then('the two assets are not in one exact group', () => notBuilt())
Given('a photo', () => notBuilt())
Given('a copy of the photo at another resolution', () => notBuilt())
Then('the two assets are in one near group', () => notBuilt())
Given('two photos that show different things', () => notBuilt())
Then('the two assets are in no duplicate group', () => notBuilt())
Given('a photo, an exact copy of it, and a resized copy of it', () => notBuilt())
Then('the three assets are in one duplicate group', () => notBuilt())
Then('the group is near', () => notBuilt())
When('the resized copy is left out', () => notBuilt())
Then('the other two assets are in one exact group', () => notBuilt())
Given('two assets with the same sha256 and different file names', () => notBuilt())
Given('the same photo in two sources', () => notBuilt())
Given('the user ranks the first source above the second in the order of sources', () => notBuilt())
Then('the keeper is the asset of the first source', () => notBuilt())
Given('three photos of one near group in the same source, all with the same resolution', () =>
  notBuilt(),
)
Given(
  'the first has the date taken, the coordinates and the camera, and the other two have none of them',
  () => notBuilt(),
)
When('the keeper is suggested', () => notBuilt())
Then('the keeper is the first photo', () => notBuilt())
Given('two photos of one near group in the same source, one with a higher resolution', () =>
  notBuilt(),
)
Then('the keeper is the photo with the higher resolution', () => notBuilt())
Given(
  'two photos of one near group in the same source with the same resolution and the same photo metadata',
  () => notBuilt(),
)
Then('the keeper is the older photo', () => notBuilt())
Given('a duplicate group with a suggested keeper', () => notBuilt())
When('the user opens the duplicate report', () => notBuilt())
When('the user changes the keeper of the group to another asset of the group', () => notBuilt())
Then('the keeper of the group is the other asset', () => notBuilt())
When('the user has not marked the group reviewed', () => notBuilt())
Then('the keeper is only a suggestion', () => notBuilt())
When('the user marks the group reviewed', () => notBuilt())
Then('the keeper counts as chosen', () => notBuilt())
Given('a reviewed duplicate group whose keeper the user changed', () => notBuilt())
When('a new asset joins the group', () => notBuilt())
Then('the group is not reviewed', () => notBuilt())
Then('the earlier keeper of the user stays as the suggestion', () => notBuilt())
Given('a duplicate group of two assets', () => notBuilt())
Then('the report shows a thumbnail and a path for each asset of the group', () => notBuilt())
Then('the thumbnails are side by side', () => notBuilt())
When('a change of the keeper is sent to the duplicate report without valid credentials', () =>
  notBuilt(),
)
Then('the duplicate report refuses the change', () => notBuilt())
Then('the keeper of the group is unchanged', () => notBuilt())
Given('a source whose account is a shared account', () => notBuilt())
Then('its assets are flagged as also belonging to someone else', () => notBuilt())
Given('duplicate groups with suggested keepers', () => notBuilt())
When('the assets are grouped and the duplicate report is opened', () => notBuilt())
Then('nothing has been deleted from any source', () => notBuilt())
Then('nothing has been moved in any source', () => notBuilt())
Given('a photo as a JPG in a source of the location {string}', (_0: string) => notBuilt())
Given('the same photo as a HEIC in a source of the location {string}', (_0: string) => notBuilt())
