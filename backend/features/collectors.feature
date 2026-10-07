Feature: Collectors
  A collector on a Mac fetches the sources that need macOS and sends what it
  fetched to the server through the API.

  @slice-2
  Scenario: The API refuses a call without valid credentials
    Given the API of the server
    When a call is made to the API without valid credentials
    Then the API refuses the call

  @slice-2 @tests-only
  Scenario: Each client of the API authenticates with its own token
    Given a collector, the command line and the browser
    When each of them authenticates with the API
    Then each of them uses its own token
    And no two of them share a token

  @slice-2 @tests-only
  Scenario: The API is served over HTTPS only
    Given the API of the server
    When a call is made to the API over plain HTTP
    Then the API does not answer the call

  @slice-9
  Scenario: The same asset seen by both Macs is one row
    Given two Macs whose collectors both fetch the same source
    When both collectors send the asset records of the same asset
    Then the index holds one row for the asset

  @slice-9
  Scenario: Asset records from a second collector for the same source update the same rows
    Given a source fetched by a collector on one Mac
    When a collector on a second Mac sends asset records for the same source
    Then the same rows are updated
    And collected_by records which Mac sent them

  @slice-9
  Scenario: A collector uploads the bytes of every asset it reports as new or changed
    Given a collector that reports one new asset and one changed asset
    When the collector sends its asset records
    Then the collector uploads the bytes of the new asset and of the changed asset

  @slice-9 @tests-only
  Scenario: A collector interrupted after sending asset records sends them again and nothing is doubled
    Given a collector that sent a batch of asset records and was interrupted before the ledger acknowledged
    When the collector sends the same batch again
    Then the index holds each asset once
