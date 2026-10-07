Feature: Photos
  Photos are assets of kind photo, found by month and by what they show.

  @slice-9
  Scenario: Albums, persons, favorites and place from iCloud Photos are kept
    Given a photo in a source of the location "icloud_photos" with an album, a person, a favorite mark and a place
    When a run of the source finishes
    Then the album, the person, the favorite mark and the place are kept with the photo

  @slice-9
  Scenario: A photo from the user's phone is whitelisted by default
    Given a photo from the user's phone
    When a run of the source finishes
    Then the photo is whitelisted

  @slice-10
  Scenario: Photos are found by month, by their asset_date
    Given a photo with the asset_date 2024-07-15
    And a photo with the asset_date 2024-08-15
    When the user looks for photos of the month 2024-07
    Then the answer has a match for the first photo only

  @slice-10
  Scenario: Photos are found by what they show
    Given a photo of a beach whose name says nothing about a beach
    When the user looks for photos with the words "beach"
    Then the answer has a match for the photo
