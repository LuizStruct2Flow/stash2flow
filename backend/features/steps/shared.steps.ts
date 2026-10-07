import { Given, Then, When } from '@cucumber/cucumber'
import { notBuilt } from '../support/not-built.ts'

When('a run of the source finishes', () => notBuilt())
When('a run of the mailbox looks at the e-mail', () => notBuilt())
Then('the e-mail is an advertisement', () => notBuilt())
Given('an e-mail with an attached PDF whose mail_label says spam, from a trusted sender', () =>
  notBuilt(),
)
Then('the e-mail is not blacklisted', () => notBuilt())
Then('the e-mail is spam', () => notBuilt())
Given(
  'an e-mail with an attached PDF whose mail_label says promotions, from an undecided sender',
  () => notBuilt(),
)
Given('an e-mail from a rejected sender', () => notBuilt())
When('a run of the mailbox finishes', () => notBuilt())
When('the asset goes through the pipeline', () => notBuilt())
When('the user starts a run of the source', () => notBuilt())
Then('the run downloads no bytes', () => notBuilt())
