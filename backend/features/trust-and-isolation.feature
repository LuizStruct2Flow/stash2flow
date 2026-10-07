Feature: Trust and isolation
  The guardian reads an asset only when where it comes from is trusted, and
  reads it in isolation, whoever the sender is. Nothing inside an asset is run.

  @slice-2
  Scenario: An asset from the user's own drives is read fully
    Given an asset from a source that is one of the user's own drives
    When the asset goes through the pipeline
    Then the guardian reads the asset fully

  @slice-2 @tests-only
  Scenario: A script inside a PDF is never run
    Given a PDF that carries a script
    When the guardian reads the asset
    Then the script is not run

  @slice-2 @tests-only
  Scenario: A macro in an office document is never run
    Given an office document that carries a macro
    When the guardian reads the asset
    Then the macro is not run
    And the text of the asset is still taken out

  @slice-2 @tests-only
  Scenario: The guardian cannot reach the network while it reads an asset
    Given an asset that makes the reading try to reach the network
    When the guardian reads the asset
    Then the guardian does not reach the network

  @slice-2 @tests-only
  Scenario: The guardian cannot reach the providers' access tokens or the database while it reads an asset
    Given an asset that makes the reading try to reach the access tokens and the database
    When the guardian reads the asset
    Then the guardian reaches neither the access tokens nor the database

  @slice-9 @tests-only
  Scenario: On a Mac the guardian cannot reach the network while it reads an asset
    Given a Mac with a collector
    And an asset that makes the reading try to reach the network
    When the guardian reads the asset on the Mac
    Then the guardian does not reach the network

  @slice-5
  Scenario: A sender the user has written to is trusted
    Given a sender the user has written to
    When a run of the mailbox looks at the sender
    Then the sender is trusted

  @slice-5
  Scenario: A sender the user marked as trusted is trusted
    Given a sender the user marked as trusted
    When a run of the mailbox looks at the sender
    Then the sender is trusted

  @slice-5
  Scenario: An e-mail from an undecided sender is not read, and the sender is listed for the user
    Given an e-mail from an undecided sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is not read
    And its sender, subject, date and mail_label are recorded
    And the sender is listed for the user

  @slice-5
  Scenario: The first run over a mailbox starts by showing the user his senders
    Given a mailbox that has never had a run
    And a sender the user has written to and a sender the user has never dealt with
    When the user starts the first run of the mailbox
    Then the run starts by showing the user his senders
    And the sender the user has written to is already trusted
    And the other sender is an undecided sender

  @slice-5
  Scenario: The user decides once per sender, not per e-mail, and the sender is not listed again
    Given an undecided sender with 3 e-mails in the mailbox
    When the user says that the sender is trusted
    Then the user is not asked about the 3 e-mails
    And the sender is not listed again

  @slice-5
  Scenario: Once an undecided sender is trusted, the next run reads its recorded e-mails
    Given an e-mail recorded while its sender was an undecided sender
    And the user has said that the sender is trusted
    When the next run of the mailbox starts
    Then the guardian reads the recorded e-mail

  @slice-5
  Scenario: An e-mail from a rejected sender is not read
    Given an e-mail from a rejected sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is not read

  @slice-5
  Scenario: An e-mail with no attached PDF, from a trusted sender, whose mail_label says promotions is still an advertisement and is not read
    Given an e-mail with no attached PDF, from a trusted sender, whose mail_label says promotions
    When a run of the mailbox looks at the e-mail
    Then the e-mail is an advertisement
    And the e-mail is not read

  @slice-5
  Scenario: An e-mail with no attached PDF, from a trusted sender, whose mail_label says spam is still spam and is not read
    Given an e-mail with no attached PDF, from a trusted sender, whose mail_label says spam
    When a run of the mailbox looks at the e-mail
    Then the e-mail is spam
    And the e-mail is not read

  @slice-5
  Scenario: An e-mail with an attached PDF whose mail_label says promotions, from a trusted sender, is read like any other e-mail from that sender
    Given an e-mail with an attached PDF whose mail_label says promotions, from a trusted sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is read like any other e-mail from that sender

  @slice-5
  Scenario: An e-mail with an attached PDF whose mail_label says spam, from a trusted sender, is read like any other e-mail from that sender
    Given an e-mail with an attached PDF whose mail_label says spam, from a trusted sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is read like any other e-mail from that sender

  @slice-5
  Scenario: An e-mail with an attached PDF whose mail_label says promotions, from an undecided sender, is only recorded
    Given an e-mail with an attached PDF whose mail_label says promotions, from an undecided sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is only recorded
    And the e-mail is not read

  @slice-5
  Scenario: An e-mail from an undecided sender is not blacklisted for that reason
    Given an e-mail from an undecided sender whose mail_label says neither promotions nor spam
    When a run of the mailbox looks at the e-mail
    Then the e-mail is not blacklisted

  @slice-5 @tests-only
  Scenario: Reading an e-mail loads nothing from the internet
    Given an e-mail whose text points at a remote image and at a link
    And the sender of the e-mail is trusted
    When the guardian reads the e-mail
    Then no remote image is loaded
    And no link is followed

  @slice-5
  Scenario: The run summary lists the undecided senders that wait for the user's decision
    Given 2 undecided senders in the mailbox
    When a run of the mailbox finishes
    Then the run summary lists the 2 undecided senders that wait for the user's decision
