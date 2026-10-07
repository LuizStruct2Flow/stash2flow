Feature: Runs
  A run is one pass over one source. It fetches, it never writes to the source,
  and a run with nothing new costs nothing.

  @slice-2
  Scenario: The user adds a source with a command
    Given the user has an account at the provider behind the location "gdrive"
    When the user adds a source with the command
    Then the command takes the user through the provider's sign-in once
    And the app stores access to the source that is read-only

  @slice-2
  Scenario: The user can start a run at any time
    Given a source whose last run finished a day ago
    When the user starts a run of the source
    Then the run starts

  @slice-2 @tests-only
  Scenario: A run never writes to a source
    Given a source holding some assets
    When a run of the source finishes
    Then nothing has been written to the source

  @slice-2
  Scenario: The first run of a source reports the source's total size before it downloads anything
    Given a source that has never had a run
    When the user starts the first run of the source
    Then the run reports the total size of the source
    And the report comes before any asset's bytes are downloaded

  @slice-2 @tests-only
  Scenario: The server keeps a local copy of every asset it indexes fully
    Given an asset that the server indexes fully
    When the run finishes
    Then the server holds a local copy of the asset's bytes in the stash

  @slice-2 @tests-only
  Scenario: The same bytes arriving from two sources are kept once in the stash
    Given the same bytes in two assets from two sources
    When a run of each source finishes
    Then the stash holds one local copy of those bytes

  @slice-2 @tests-only
  Scenario: File names are stored in NFC
    Given a file whose name a Mac wrote in another normal form
    When the run stores the asset
    Then the name of the asset is stored in NFC

  @slice-3
  Scenario: An interrupted run resumes where it stopped
    Given a first run of a source that was interrupted after some assets
    When the user starts the run again
    Then the run continues from its checkpoint
    And the assets before the checkpoint are not fetched again

  @slice-3
  Scenario: A second run with no changes downloads nothing and processes nothing
    Given a source whose first run has finished
    And nothing in the source has changed
    When the user starts a second run of the source
    Then the run downloads no bytes
    And no pipeline step runs for any asset

  @slice-3
  Scenario: An asset that shows a newer date but has the same hash is recognised as already read and is not processed again
    Given an asset that has been read
    And the source now shows a newer date for it
    And its sha256 is the same
    When the user starts a run of the source
    Then the date of the asset is updated
    And no pipeline step runs for the asset again

  @slice-3
  Scenario: A changed asset is processed again
    Given an asset that has been read
    And its bytes have changed in the source
    When the user starts a run of the source
    Then the asset goes through the pipeline again

  @slice-3
  Scenario: An asset that vanished from its source keeps its row and gets deleted_at
    Given an asset that has been read
    And the asset has been removed from its source
    When the user starts a run of the source
    Then the row of the asset is still in the index
    And the asset has deleted_at set

  @slice-3
  Scenario: An asset that fails is recorded in the run's errors and the run goes on
    Given a source holding two assets, the first of which fails
    When the user starts a run of the source
    Then the failure of the first asset is recorded in the errors of the run
    And the second asset is processed

  @slice-3
  Scenario: The user can see a run's state and its errors
    Given a run that has recorded an error
    When the user asks to see the run
    Then the user sees the state of the run
    And the user sees its error

  @slice-3 @tests-only
  Scenario: A source's cursor moves only when every asset record up to it is stored
    Given a batch of asset records sent to the ledger
    When the ledger has not stored every asset record of the batch
    Then the cursor of the source has not moved
    When the ledger has stored every asset record of the batch
    Then the cursor of the source moves to the end of the batch

  @slice-4
  Scenario: A folder on a network storage device is fetched by the server like any other source
    Given a source of the location "network_folder" that the server can reach
    When the user starts a run of the source
    Then the server fetches the assets of the folder
    And the server is the reader of the source

  @slice-4 @provisional
  Scenario: A folder on a network storage device is added as a source by its address, with no sign-in
    Given a folder on a network storage device
    When the user adds a source with the command and the address of the folder
    Then the source is added
    And the user is not taken through any sign-in

  @slice-9
  Scenario: A full run over all sources finishes
    Given every source of the user
    When the user starts a run of each source
    Then every run finishes

  @slice-11
  Scenario: A run starts by itself only when 30 days have passed since the source's last finished run
    Given a source whose last finished run was 30 days ago
    When the scheduler looks at the source
    Then a run of the source starts by itself

  @slice-11
  Scenario: A source with no finished run does not start by itself
    Given a source that has no finished run
    When the scheduler looks at the source
    Then no run of the source starts by itself

  @slice-11
  Scenario: A run that failed or was interrupted does not move the date
    Given a source whose last finished run was 20 days ago
    And a later run of the source failed
    When 10 more days pass
    Then a run of the source starts by itself

  @slice-11
  Scenario: Running one source does not postpone the others
    Given two sources whose last finished run was 29 days ago
    When the user starts a run of the first source and it finishes
    And 1 more day passes
    Then a run of the second source starts by itself

  @slice-11
  Scenario: A Mac that was asleep when its run was due runs when it wakes
    Given a Mac with a collector whose run was due while the Mac was asleep
    When the Mac wakes
    Then the run of the collector starts

  @slice-11
  Scenario: A summary notification reports new assets, new duplicates and errors
    Given a run that found 3 new assets, 2 new duplicates and 1 error
    When the run finishes
    Then the summary notification reports 3 new assets, 2 new duplicates and 1 error
