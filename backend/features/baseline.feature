Feature: Baseline
  The baseline records what the user had before organizing and cleaning up,
  at the first full run of a source, and keeps it unchanged.

  @slice-2
  Scenario: The first full run of a source records in the baseline how many assets and how many bytes the source holds
    Given a source holding 10 assets of 5000 bytes in all
    When the first full run of the source finishes
    Then the baseline of the source records 10 assets
    And the baseline of the source records 5000 bytes

  @slice-3 @tests-only
  Scenario: A later run leaves the baseline unchanged
    Given a source whose first full run recorded its baseline
    And the source now holds more assets
    When a later run of the source finishes
    Then the baseline of the source is unchanged

  @slice-5
  Scenario: The baseline counts the blacklisted assets per source, advertisements included
    Given a mailbox with 2 advertisements that are blacklisted and 3 other blacklisted assets
    When the first full run of the mailbox finishes
    Then the baseline of the source counts 5 blacklisted assets

  @slice-8
  Scenario: The baseline counts the exact duplicates and the near duplicates per source
    Given a source holding 2 exact duplicates and 3 near duplicates
    When the first full run of the source finishes
    Then the baseline of the source counts 2 exact duplicates and 3 near duplicates

  @slice-8
  Scenario: The baseline records, over all sources, the number of sources an asset is found in
    Given the same asset in 3 sources
    When the first full run of each source finishes
    Then the baseline records that the asset is found in 3 sources
