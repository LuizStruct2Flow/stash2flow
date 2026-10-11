Feature: Duplicates
  Assets that are the same form a duplicate group, across all sources and
  accounts. The index suggests a keeper and deletes nothing.

  @slice-8
  Scenario: The same bytes in two sources form one exact group
    Given the same bytes in an asset of one source and an asset of another source
    When the assets are grouped
    Then the two assets are in one duplicate group
    And the group is exact

  @slice-8
  Scenario: An attachment that also exists in Google Drive lands in the same exact group
    Given a PDF that is an attachment of an e-mail
    And the same PDF in a source of the location "gdrive"
    When the assets are grouped
    Then the attachment and the asset in the source of the location "gdrive" are in one exact group

  @slice-8
  Scenario: The same bytes on a network storage device and on its copy form exact duplicates, and the order of sources decides the keeper
    Given the same bytes in a source of the location "network_folder" and in its copy
    And the user ranks the copy above the network folder in the order of sources
    When the assets are grouped
    Then the two assets are exact duplicates
    And the keeper is the asset of the copy

  @slice-8
  Scenario: A video of a source whose videos are not fetched is not recognised as an exact duplicate of a copy at another provider
    Given a video in a source whose videos are not fetched
    And the same video at another provider
    When the assets are grouped
    Then the two assets are not in one exact group

  @slice-8
  Scenario: A resized or recompressed copy joins the near group
    Given a photo
    And a copy of the photo at another resolution
    When the assets are grouped
    Then the two assets are in one near group

  @slice-8
  Scenario: Different photos are not grouped
    Given two photos that show different things
    When the assets are grouped
    Then the two assets are in no duplicate group

  @slice-8
  Scenario: An asset is in one duplicate group only
    Given a photo, an exact copy of it, and a resized copy of it
    When the assets are grouped
    Then the three assets are in one duplicate group
    And the group is near
    When the resized copy is left out
    Then the other two assets are in one exact group

  @slice-8
  Scenario: Two assets are exact duplicates when their sha256 is the same
    Given two assets with the same sha256 and different file names
    When the assets are grouped
    Then the two assets are exact duplicates

  @slice-8
  Scenario: The keeper is suggested from the user's order of sources
    Given the same photo in two sources
    And the user ranks the first source above the second in the order of sources
    When the assets are grouped
    Then the keeper is the asset of the first source

  @slice-8
  Scenario: Inside the winning source, ties go to the highest resolution, then complete photo metadata, then the oldest
    Given three photos of one near group in the same source, all with the same resolution
    And the first has the date taken, the coordinates and the camera, and the other two have none of them
    When the keeper is suggested
    Then the keeper is the first photo
    Given two photos of one near group in the same source, one with a higher resolution
    When the keeper is suggested
    Then the keeper is the photo with the higher resolution
    Given two photos of one near group in the same source with the same resolution and the same photo metadata
    When the keeper is suggested
    Then the keeper is the older photo

  @slice-8
  Scenario: The user can change the keeper of a duplicate group in the duplicate report
    Given a duplicate group with a suggested keeper
    When the user opens the duplicate report
    And the user changes the keeper of the group to another asset of the group
    Then the keeper of the group is the other asset

  @slice-8
  Scenario: A suggested keeper stays a suggestion until the user marks the group reviewed
    Given a duplicate group with a suggested keeper
    When the user has not marked the group reviewed
    Then the keeper is only a suggestion
    When the user marks the group reviewed
    Then the keeper counts as chosen

  @slice-8
  Scenario: A new asset joining a reviewed group puts it back to not reviewed
    Given a reviewed duplicate group whose keeper the user changed
    When a new asset joins the group
    Then the group is not reviewed
    And the earlier keeper of the user stays as the suggestion

  @slice-8
  Scenario: The duplicate report shows thumbnails and paths side by side
    Given a duplicate group of two assets
    When the user opens the duplicate report
    Then the report shows a thumbnail and a path for each asset of the group
    And the thumbnails are side by side

  @slice-8
  Scenario: The duplicate report refuses a change without valid credentials
    Given a duplicate group with a suggested keeper
    When a change of the keeper is sent to the duplicate report without valid credentials
    Then the duplicate report refuses the change
    And the keeper of the group is unchanged

  @slice-8
  Scenario: Assets in a shared account are flagged as also belonging to someone else
    Given a source whose account is a shared account
    When a run of the source finishes
    Then its assets are flagged as also belonging to someone else

  @slice-8
  Scenario: The index deletes nothing and moves nothing
    Given duplicate groups with suggested keepers
    When the assets are grouped and the duplicate report is opened
    Then nothing has been deleted from any source
    And nothing has been moved in any source

  @slice-9
  Scenario: The same photo as JPG in OneDrive and HEIC in iCloud Photos lands in one near group
    Given a photo as a JPG in a source of the location "onedrive"
    And the same photo as a HEIC in a source of the location "icloud_photos"
    When the assets are grouped
    Then the two assets are in one near group
