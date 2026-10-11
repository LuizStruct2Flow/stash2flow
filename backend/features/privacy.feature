Feature: Privacy
  No text of an asset and no image of it leaves the user's network.

  @slice-2
  Scenario: Processing an asset uses local models only
    Given an asset that goes through the pipeline
    When every step that uses a model runs
    Then each model runs inside the app's process or at a model server on the user's network

  @slice-2
  Scenario: A source's credential is kept encrypted in the token store, and every permission asked of a provider is read-only
    Given a source that the user has added
    When the app stores the access it needs
    Then the source's credential is kept encrypted in the token store
    And every permission asked of the provider is read-only

  @slice-9
  Scenario: iCloud Photos is fetched only through osxphotos
    Given a source of the location "icloud_photos"
    When the collector fetches the source
    Then the photo library is reached only through osxphotos
