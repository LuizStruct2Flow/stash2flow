Feature: Pipeline
  The steps an asset goes through, in one order, for every asset that is read.

  @slice-2
  Scenario: A PDF with a text layer is not sent to OCR
    Given an asset that is a PDF with a text layer
    When the asset goes through the pipeline
    Then the text layer is used
    And the asset is not sent to OCR

  @slice-2
  Scenario: Every image and every PDF without a text layer gets OCR
    Given an asset that is an image
    And an asset that is a PDF without a text layer
    When the assets go through the pipeline
    Then both assets get OCR

  @slice-2
  Scenario: OCR text is stored per page in its original language
    Given a PDF of two pages in Portuguese without a text layer
    When the asset goes through the pipeline
    Then the OCR text of each page is stored separately
    And the OCR text is stored in Portuguese

  @slice-2
  Scenario: The text of an office document is read, and the asset is found by it
    Given an asset that is a word-processor file with some text in it
    When the asset goes through the pipeline
    Then the guardian takes its text out
    And a search for that text has a match for the asset

  @slice-2
  Scenario: An archive is not opened and is listed as not covered
    Given an asset that is an archive
    When the asset goes through the pipeline
    Then the name, size and hash of the asset are recorded
    And the archive is not opened
    And the archive is listed for the user as not covered

  @slice-2
  Scenario: Of a program, or of a file whose file type the app does not know, only the name, size and hash are recorded
    Given an asset that is a program
    And an asset that is a file whose file type the app does not know
    When the assets go through the pipeline
    Then only the name, size and hash of each asset are recorded
    And the guardian never reads either asset

  @slice-2
  Scenario: A file beyond the user's limit on size or on the number of pages is not read
    Given the user has set a limit of 10 pages
    And an asset that is a PDF of 11 pages
    When the asset goes through the pipeline
    Then the guardian does not read the asset

  @slice-2
  Scenario: asset_date uses the best available date and records its source
    Given an asset with a date taken in its own data and a different modification time
    When the asset goes through the pipeline
    Then the asset_date is the date taken
    And the asset_date_source says that it came from the photo's own data

  @slice-4
  Scenario: For each source the user sets whether its videos are fetched and kept as a local copy
    Given two sources
    When the user sets that the videos of the first source are fetched
    And the user sets that the videos of the second source are not fetched
    Then the app stores that setting with each source

  @slice-4
  Scenario: Where a source's videos are fetched, a video is read like any other file and never gets OCR
    Given a source whose videos are fetched, holding a video
    When the video goes through the pipeline
    Then the video gets its hashes
    And the video gets a local copy
    And the video does not get OCR

  @slice-4
  Scenario: Where a source's videos are not fetched, a video is not fetched
    Given a source whose videos are not fetched, holding a video
    When the video goes through the pipeline
    Then no bytes of the video are fetched
    And only the name, size and dates that the provider's listing gives are stored
    And the provider hash of the video is stored

  @slice-4
  Scenario: A source's videos are not fetched until the user sets it
    Given a source for which the user has not set whether its videos are fetched
    And the source holds a video
    When the user starts a run of the source
    Then the videos of the source are not fetched

  @slice-6
  Scenario Outline: kind and has_text follow the agreed examples
    Given an asset described as "<example>"
    When the asset goes through the pipeline
    Then the kind of the asset is "<kind>"
    And has_text is "<has_text>"

    Examples:
      | example                                                     | kind       | has_text |
      | a picture taken by a camera, with a date taken and a camera | photo      | false    |
      | a picture with no camera data, showing lines of text        | screenshot | true     |
      | a scan of a letter with a paragraph of text                 | document   | true     |
      | a scan of a page with only a few words                      | document   | false    |

  @slice-6
  Scenario: Only an asset of kind document gets a description
    Given an asset of kind document
    And an asset of kind photo
    When the assets go through the pipeline
    Then the asset of kind document gets a description
    And the asset of kind photo gets no description

  @slice-6
  Scenario: A description is one English line and keeps proper names verbatim
    Given an asset of kind document in Portuguese that names an institution
    When the asset goes through the pipeline
    Then the description is one line
    And the description is in English
    And the name of the institution is written as it is in the asset

  @slice-6
  Scenario: doc_type always comes from the vocabulary
    Given an asset of kind document
    When the asset goes through the pipeline
    Then the doc_type of the asset is one of the doc_types of the vocabulary

  @slice-6
  Scenario: An asset indexed before a pipeline step existed gets that step only when the user asks for re-indexing
    Given an asset that was indexed before a pipeline step existed
    When the user starts an ordinary run of its source
    Then the asset does not get the step
    When the user asks for re-indexing with the step
    Then the asset gets the step

  @slice-6
  Scenario: Re-indexing fetches nothing
    Given an asset already indexed with its local copy in the stash
    When the user asks for re-indexing with a step
    Then the run fetches no bytes
