Feature: Search
  The user finds assets by the words in them and by what they are,
  whichever source they came from.

  @slice-2
  Scenario: A scan with no text layer is found by its OCR text
    Given a source holding a scan of a receipt as a PDF with no text layer
    And a run of the source has finished
    When the user searches for words printed on the receipt
    Then the answer has a match for the scan

  @slice-2
  Scenario: Search ignores accents
    Given an asset whose OCR text says "Certidão"
    When the user searches for "certidao"
    Then the answer has a match for that asset

  @slice-2
  Scenario: Search tolerates OCR misreadings
    Given an asset whose OCR text says "rec1bo"
    When the user searches for "recibo"
    Then the answer has a match for that asset

  @slice-2
  Scenario: Every match carries a source_link
    Given an asset whose OCR text says "recibo"
    When the user searches for "recibo"
    Then every match in the answer carries the source_link of its asset

  @slice-3
  Scenario: A vanished asset is left out of the answer, and the answer says how many were left out
    Given an asset whose OCR text says "recibo" that has vanished from its source
    When the user searches for "recibo"
    Then the answer has no match for that asset
    And the answer says that 1 asset was left out

  @slice-3
  Scenario: With the flag, a vanished asset is shown in the answer
    Given an asset whose OCR text says "recibo" that has vanished from its source
    When the user searches for "recibo" with the flag that shows vanished assets
    Then the answer has a match for that asset

  @slice-6
  Scenario: Search filters by doc_type
    Given an asset of kind document with doc_type "tax"
    And an asset of kind document with doc_type "invoice"
    When the user searches with the doc_type "tax"
    Then the answer has a match for the asset with doc_type "tax" only

  @slice-6
  Scenario: Search filters by person, and an asset of kind document with two persons is found under each of them
    Given an asset of kind document about two persons on the user's list
    When the user searches with the first person
    Then the answer has a match for that asset
    When the user searches with the second person
    Then the answer has a match for that asset

  @slice-6
  Scenario: Search filters assets of kind document by date range on the doc_date
    Given an asset of kind document with the doc_date 2010-05-01
    And an asset of kind document with the doc_date 2020-05-01
    When the user searches with the date range from 2005 to 2015
    Then the answer has a match for the asset with the doc_date 2010-05-01 only

  @slice-6
  Scenario: An asset of kind document with no doc_date is found in a date range by its asset_date
    Given an asset of kind document with no doc_date and the asset_date 2010-05-01
    When the user searches with the date range from 2005 to 2015
    Then the answer has a match for that asset

  @slice-7
  Scenario: A query in another language finds the asset
    Given a scan of a receipt in Portuguese whose OCR text has been read
    When the user searches for English words that mean what the receipt says
    Then the answer has a match for the scan
