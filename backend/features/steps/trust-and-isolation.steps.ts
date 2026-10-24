import { Given, Then, When } from '@cucumber/cucumber'
import { notBuilt } from '../support/not-built.ts'

// The steps of the guardian's reading on the server are in
// trust-and-isolation.integration.steps.ts: they use the real adapters.
Given('a Mac with a collector', () => notBuilt())
When('the guardian reads the asset on the Mac', () => notBuilt())
Given('a sender the user has written to', () => notBuilt())
When('a run of the mailbox looks at the sender', () => notBuilt())
Then('the sender is trusted', () => notBuilt())
Given('a sender the user marked as trusted', () => notBuilt())
Given('an e-mail from an undecided sender', () => notBuilt())
Then('the e-mail is not read', () => notBuilt())
Then('its sender, subject, date and mail_label are recorded', () => notBuilt())
Then('the sender is listed for the user', () => notBuilt())
Given('a mailbox that has never had a run', () => notBuilt())
Given('a sender the user has written to and a sender the user has never dealt with', () =>
  notBuilt(),
)
When('the user starts the first run of the mailbox', () => notBuilt())
Then('the run starts by showing the user his senders', () => notBuilt())
Then('the sender the user has written to is already trusted', () => notBuilt())
Then('the other sender is an undecided sender', () => notBuilt())
Given('an undecided sender with 3 e-mails in the mailbox', () => notBuilt())
When('the user says that the sender is trusted', () => notBuilt())
Then('the user is not asked about the 3 e-mails', () => notBuilt())
Then('the sender is not listed again', () => notBuilt())
Given('an e-mail recorded while its sender was an undecided sender', () => notBuilt())
Given('the user has said that the sender is trusted', () => notBuilt())
When('the next run of the mailbox starts', () => notBuilt())
Then('the guardian reads the recorded e-mail', () => notBuilt())
Given(
  'an e-mail with no attached PDF, from a trusted sender, whose mail_label says promotions',
  () => notBuilt(),
)
Given('an e-mail with no attached PDF, from a trusted sender, whose mail_label says spam', () =>
  notBuilt(),
)
Given(
  'an e-mail with an attached PDF whose mail_label says promotions, from a trusted sender',
  () => notBuilt(),
)
Then('the e-mail is read like any other e-mail from that sender', () => notBuilt())
Then('the e-mail is only recorded', () => notBuilt())
Given('an e-mail from an undecided sender whose mail_label says neither promotions nor spam', () =>
  notBuilt(),
)
Given('an e-mail whose text points at a remote image and at a link', () => notBuilt())
Given('the sender of the e-mail is trusted', () => notBuilt())
When('the guardian reads the e-mail', () => notBuilt())
Then('no remote image is loaded', () => notBuilt())
Then('no link is followed', () => notBuilt())
Given('2 undecided senders in the mailbox', () => notBuilt())
Then("the run summary lists the 2 undecided senders that wait for the user's decision", () =>
  notBuilt(),
)
