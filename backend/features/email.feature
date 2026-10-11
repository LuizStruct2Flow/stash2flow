Feature: E-mail
  Every e-mail is judged by what it is, not by who sent it. The mail_label is
  applied before trust.

  @slice-5
  Scenario: An e-mail whose mail_label says promotions is an advertisement
    Given an e-mail whose mail_label says promotions
    When a run of the mailbox looks at the e-mail
    Then the e-mail is an advertisement

  @slice-5
  Scenario: An e-mail that carries an unsubscribe header and whose mail_label does not say promotions is not an advertisement
    Given an e-mail that carries an unsubscribe header
    And its mail_label does not say promotions
    When a run of the mailbox looks at the e-mail
    Then the e-mail is not an advertisement

  @slice-5
  Scenario: An invoice that carries an unsubscribe header, from a trusted sender, is indexed fully
    Given an invoice that carries an unsubscribe header, from a trusted sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is indexed fully

  @slice-5
  Scenario: An e-mail with an attached PDF whose mail_label says spam, from a trusted sender, is not blacklisted
    Given an e-mail with an attached PDF whose mail_label says spam, from a trusted sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is not blacklisted

  @slice-5
  Scenario: An e-mail with an attached PDF whose mail_label says spam, from a sender that is not trusted, is spam and is blacklisted
    Given an e-mail with an attached PDF whose mail_label says spam, from a sender that is not trusted
    When a run of the mailbox looks at the e-mail
    Then the e-mail is spam
    And the e-mail is blacklisted

  @slice-5
  Scenario: An e-mail with an attached PDF whose mail_label says promotions, from an undecided sender, is blacklisted one week after it arrived
    Given an e-mail with an attached PDF whose mail_label says promotions, from an undecided sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is an advertisement like any other
    And the e-mail is blacklisted one week after it arrived

  @slice-5
  Scenario: An e-mail with no attached PDF whose mail_label says spam is spam and is blacklisted
    Given an e-mail with no attached PDF whose mail_label says spam
    When a run of the mailbox looks at the e-mail
    Then the e-mail is spam
    And the e-mail is blacklisted

  @slice-5
  Scenario: An e-mail from a rejected sender is spam and is blacklisted
    Given an e-mail from a rejected sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is spam
    And the e-mail is blacklisted

  @slice-5
  Scenario: An advertisement is recorded with its sender, subject, date and mail_label only
    Given an advertisement
    When a run of the mailbox looks at the e-mail
    Then the sender, subject, date and mail_label are recorded
    And there is no local copy
    And there is no description
    And no other pipeline step runs

  @slice-5
  Scenario: Spam is recorded with its sender, subject, date and mail_label only
    Given an e-mail that is spam
    When a run of the mailbox looks at the e-mail
    Then the sender, subject, date and mail_label are recorded
    And there is no local copy
    And there is no description

  @slice-5
  Scenario: An advertisement that arrived less than one week ago is neither whitelisted nor blacklisted
    Given an advertisement that arrived 6 days ago
    When a run of the mailbox looks at the e-mail
    Then the e-mail is neither whitelisted nor blacklisted

  @slice-5
  Scenario: An advertisement that arrived more than one week ago is blacklisted
    Given an advertisement that arrived 8 days ago
    When a run of the mailbox looks at the e-mail
    Then the e-mail is blacklisted

  @slice-5
  Scenario: An advertisement recorded in its week is blacklisted at the first run after the week has passed, although it is unchanged
    Given an advertisement recorded 3 days after it arrived
    And the advertisement has not changed
    When the first run of the mailbox after the week has passed looks at the e-mail
    Then the e-mail is blacklisted

  @slice-5
  Scenario: An e-mail from a trusted sender that is neither advertisement nor spam is indexed fully
    Given an e-mail from a trusted sender that is neither an advertisement nor spam
    And the e-mail has an attachment
    When a run of the mailbox looks at the e-mail
    Then the message body is indexed
    And the attachment is indexed

  @slice-5
  Scenario: An attachment of an e-mail that is indexed fully goes through the same pipeline as any other asset
    Given an e-mail that is indexed fully, with an attached PDF
    When a run of the mailbox looks at the e-mail
    Then the attachment is indexed as an asset
    And the attachment goes through the same pipeline as any other asset

  @slice-5
  Scenario: The same trusted sender can send an invoice that is indexed fully and an offer that is an advertisement
    Given a trusted sender
    And an invoice from the sender
    And an offer from the sender whose mail_label says promotions
    When a run of the mailbox looks at both e-mails
    Then the invoice is indexed fully
    And the offer is an advertisement

  @slice-5
  Scenario: A no-reply sender is not taken for advertisement
    Given an invoice from a trusted sender whose address is a no-reply address
    When a run of the mailbox looks at the e-mail
    Then the e-mail is not an advertisement
    And the e-mail is indexed fully

  @slice-5
  Scenario: A picture inside an e-mail's text is not an attachment
    Given an e-mail whose text holds a logo as a picture
    When a run of the mailbox looks at the e-mail
    Then the logo is not an attachment

  @slice-5
  Scenario: An attachment's asset_date is the date received
    Given an e-mail with an attached PDF, received on 2020-03-04
    When a run of the mailbox looks at the e-mail
    Then the asset_date of the attachment is 2020-03-04
    And the asset_date_source says that it is the date the e-mail was received

  @slice-5
  Scenario: An attachment's source_link opens its Gmail thread
    Given an e-mail with an attached PDF
    When a run of the mailbox looks at the e-mail
    Then the source_link of the attachment opens the Gmail thread of the e-mail

  @slice-5
  Scenario: A personal e-mail from a sender who is a person on the user's list is whitelisted by default
    Given a sender who is a person on the user's list
    And a personal e-mail from the sender
    When a run of the mailbox looks at the e-mail
    Then the e-mail is whitelisted

  @slice-5
  Scenario: A blacklisted e-mail stays in its mailbox
    Given an e-mail that is blacklisted
    When a run of the mailbox looks at the e-mail
    Then the e-mail is still in its mailbox
    And the index only records the verdict

  @slice-5
  Scenario: The run summary counts the advertisements, the spam and the blacklisted assets
    Given a mailbox with 2 advertisements, 3 e-mails that are spam and 4 blacklisted assets
    When a run of the mailbox finishes
    Then the run summary counts 2 advertisements, 3 spam and 4 blacklisted assets
