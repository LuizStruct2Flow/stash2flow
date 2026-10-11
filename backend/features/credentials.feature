Feature: Credentials
  The user binds the app to a provider, and administers each source's
  credential without exposing it.

  Scenario: The user binds the app to a provider with a command, and replaces the binding with the same command
    Given the app is not bound to the provider behind the location "gdrive"
    When the user binds the app to the provider with a command and a binding
    And the user binds the app to the provider with the command and another binding
    Then the token store holds the other binding for the provider

  Scenario: The user sees every source with the state of its credential and when it was last used
    Given sources whose credentials are valid, expire on a date, are expired and are missing
    When the user lists the sources
    Then every source is listed with the state of its credential and when it was last used

  @slice-2
  Scenario: No command and no log prints a credential in full
    Given a source with a credential
    When the user lists the sources
    Then no command and no log prints the credential in full

  Scenario: The app renews a source's credential by itself when it can be renewed without the user
    Given a source with an expired credential that can be renewed without the user
    When the user starts a run of the source
    Then the app renews the source's credential
    And the run starts

  Scenario: A run of a source whose credential is missing, or is expired and cannot be renewed, does not start
    Given a source whose credential is missing
    When the user starts a run of the source
    Then the run does not start
    And the source needs the user to sign in again
    Given a source with an expired credential that cannot be renewed
    When the user starts a run of the source
    Then the run does not start
    And the source needs the user to sign in again

  Scenario: The user signs in again for a source, and the source and everything indexed from it stay
    Given a source with a missing credential and an indexed asset
    When the user signs in again for the source
    Then the source has a valid credential
    And the source stays
    And the indexed asset stays

  Scenario: Signing in again for a source asks the provider for its read-only permission only
    Given a source with a missing credential
    When the user signs in again for the source
    Then the sign-in asks the provider for its read-only permission only

  Scenario: Signing in again with another account than the source's own is refused
    Given a source with a missing credential
    When the user signs in again with another account than the source's own
    Then the sign-in is refused
    And the source's credential is still missing

  Scenario: The user removes a source's credential
    Given a source with a valid credential and an indexed asset
    When the user removes the source's credential
    Then the source is no longer fetched
    And the source stays
    And the indexed asset stays
