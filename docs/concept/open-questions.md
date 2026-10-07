# Open questions

Everything that still waits for the founder's ruling, in one place. Each
question states the point in one or two sentences and gives the
recommendation. Nothing here is decided; once a question is ruled, its answer
moves into the document it belongs to and the question is removed from this
one.

The other concept documents mark each open spot with a link to its question
here.

## E-mail

Background:
[each e-mail is judged by what it is](sources.md#each-e-mail-is-judged-by-what-it-is).

### Question: attachment id

`#question-attachment-id`

**Question.** An [attachment](domain-language.md#attachment)'s id is the
message's id plus the attachment's id, but the
[provider](domain-language.md#provider)'s attachment id may not be stable
between calls. And no id is defined for a
[message body](domain-language.md#message-body).

**Recommendation.** Verify it when [e-mail](domain-language.md#e-mail) is built.
If it is unstable, use the message's id plus the attachment's part number. For a
body: the message's id plus "body".

## Reading and trust

Background:
[the app reads what it trusts, in isolation, and runs nothing](principles.md#the-app-reads-what-it-trusts-in-isolation-and-runs-nothing).

### Question: how reading is isolated

`#question-how-reading-is-isolated`

**Question.** The [guardian](domain-language.md#guardian) reads an
[asset](domain-language.md#asset) in isolation: it may reach neither the
network, nor the [providers](domain-language.md#provider)' access tokens, nor
the database. With what is that made, on the
[server](domain-language.md#server) and on a Mac, where a
[collector](domain-language.md#collector) works with files?

**Recommendation.** Choose it in slice 1, together with the reading libraries,
and prove it there with a test in which the guardian tries to reach the
network and fails. No real [asset](domain-language.md#asset) is read before
that test is green.

## Kept and trash

Background:
[whitelisted, blacklisted or neither](how-it-works.md#whitelisted-blacklisted-or-neither).

### Question: where the quarantine is

`#question-where-the-quarantine-is`

**Question.** The [user](domain-language.md#user) sees one
[quarantine](domain-language.md#quarantine) in the app, for all
[sources](domain-language.md#source). Where does an
[asset](domain-language.md#asset) in it physically sit until it is deleted: in
a place the app keeps, or in one the [provider](domain-language.md#provider)
already has?

**Recommendation.** In each [provider](domain-language.md#provider)'s own
trash. It already lets the [user](domain-language.md#user) restore an item and
deletes it by itself after a period; the app shows them together, as one
[quarantine](domain-language.md#quarantine). To verify per provider before
relying on it: that the period is 30 days.

### Question: whitelisted asset in the quarantine

`#question-whitelisted-asset-in-the-quarantine`

**Question.** Can a [whitelisted](domain-language.md#whitelist)
[asset](domain-language.md#asset) still reach the
[quarantine](domain-language.md#quarantine), for example as the
[non-keeper](domain-language.md#non-keeper) of a
[duplicate group](domain-language.md#duplicate-group)?

**Recommendation.** Yes. A [duplicate](domain-language.md#duplicate) is trash
even when the [keeper](domain-language.md#keeper) is whitelisted. Whitelisting
protects what the asset is, not every copy of it.

## Duplicates

Background: [how duplicates work](how-it-works.md#duplicates).

### Question: near matching PDFs

`#question-near-matching-pdfs`

**Question.** [Near](domain-language.md#near) matching of PDFs compares the
first page. Two different letters on the same letterhead may then match. Is that
acceptable?

**Recommendation.** Measure it on fixtures when duplicates are built. If it
happens, [near](domain-language.md#near) groups are limited to images and PDFs
match only exactly.

### Question: moving non-keepers

`#question-moving-non-keepers`

**Question.** Should the index item be able to move
[non-keepers](domain-language.md#non-keeper) into a review folder inside their
[source](domain-language.md#source), after confirmation? It would be the only
write to a source.

**Recommendation.** No. The index reports only. Moving is a later item with its
own specifications.

## Pipeline and models

Background: [pipeline steps](how-it-works.md#pipeline-steps).

### Question: which models

`#question-which-models`

**Question.** Which OCR engine, which
[description](domain-language.md#description) model and which
[embedding](domain-language.md#embedding) models?

**Recommendation.** Benchmark first. Slice 1 picks the OCR engine on a sample
of real [scans](domain-language.md#scan) and measures
files per hour for OCR and both
[embeddings](domain-language.md#embedding). The description model is picked the
same way when descriptions are built. Candidates must run on the
[server](domain-language.md#server)'s hardware.

## Local copies

Background: [a local copy of every asset](principles.md#a-local-copy-of-every-asset).

### Question: disk encryption

`#question-disk-encryption`

**Question.** The [server](domain-language.md#server)'s disk will hold every
private document, so it must be encrypted. When and how is that ensured?

**Recommendation.** Encrypt it before slice 2 of the plan, the first slice
that keeps [assets](domain-language.md#asset) on the server.

## Sources and collectors

Background: [the Mac collector](sources.md#mac-collector).

### Question: what tells two network folders apart

`#question-what-tells-two-network-folders-apart`

**Question.** A [source](domain-language.md#source) is a
[location](domain-language.md#location) plus an
[account](domain-language.md#account), and that is what tells two sources
apart. A `network_folder` has no account. What tells a network storage device
and its copy apart?

**Recommendation.** For a `network_folder`, the address of the folder takes
the place of the account.

### Question: how long a sign-in stays valid

`#question-how-long-a-sign-in-stays-valid`

**Question.** Signing in to a [provider](domain-language.md#provider) means
registering the app with that provider. Does a sign-in made that way stay
valid for the [30 days](how-it-works.md#thirty-days) between
[runs](domain-language.md#run)?

**Recommendation.** Verify it in the first search slice, for each
[provider](domain-language.md#provider), before the slice is called done. A
sign-in that expires sooner would break the rhythm in which a
[source](domain-language.md#source) is [fetched](domain-language.md#fetching)
by itself.

### Question: a provider's own documents

`#question-a-providers-own-documents`

**Question.** A [provider](domain-language.md#provider)'s own document, for
example a word-processor or spreadsheet document that lives only in the
provider's web application, is not a file: it has no
[bytes](domain-language.md#bytes) to fetch. What does the app do with it?

**Recommendation.** The app exports each one as a PDF and reads that, so they
are searchable like everything else.

### Question: local copy of a file that is not read

`#question-local-copy-of-a-file-that-is-not-read`

**Question.** An archive, a program or a file over the limits is recorded by
name, size and hash and is not read. Does the
[server](domain-language.md#server) keep a
[local copy](domain-language.md#local-copy) of it?

**Recommendation.** Yes. It may matter to the
[user](domain-language.md#user) even though the app cannot look inside it, and
the path ends with one copy of everything that matters.

### Question: office documents as attachments

`#question-office-documents-as-attachments`

**Question.** An [attachment](domain-language.md#attachment) is described as a
PDF or an image. Is an office document attached to an
[e-mail](domain-language.md#e-mail) an attachment too?

**Recommendation.** Yes. From a [trusted](domain-language.md#trusted)
[sender](domain-language.md#sender) it is read like any other office document.

### Question: photo originals

`#question-photo-originals`

**Question.** When a Mac is set to keep only small versions of its photos, the
originals are not on the Mac. How does the
[collector](domain-language.md#collector) get the
[bytes](domain-language.md#bytes)?

**Recommendation.** The [collector](domain-language.md#collector) asks
`osxphotos` to download the original. Confirm the Mac's setting before the
collector is built.

## Server and security

Background: [infrastructure.md](infrastructure.md).

### Question: server setup

`#question-server-setup`

**Question.** How are the [server](domain-language.md#server)'s parts
(database, [API](domain-language.md#api), [workers](domain-language.md#worker),
timer) installed and kept running?

**Recommendation.** Scripted in `infra/` as system services rather than
containers, because the models need the machine's hardware. Settled in slice 1.
The machine can be rebuilt from the repository.

### Question: public repository check

`#question-public-repository-check`

**Question.** How is it checked that no [account](domain-language.md#account)
data reaches the public repository?

**Recommendation.** A check in the gate that refuses a push whose tracked files
contain any value from the private configuration (account addresses, person
names, [senders](domain-language.md#sender)). It lands in slice 1, before the
first source is wired.

### Question: backup transport

`#question-backup-transport`

**Question.** The [server](domain-language.md#server) runs Linux and iCloud has
no client for it. How does the backup get to iCloud?

**Recommendation.** The script writes one encrypted, dated file per run. A Mac
fetches it from the server into a folder of its iCloud Drive, and macOS uploads
it. That folder is left out of the index, because iCloud Drive is also a
[source](domain-language.md#source). Not recommended: a tool that writes to
iCloud straight from the server, because its login has to be renewed by hand.

### Question: copyright line

`#question-copyright-line`

**Question.** The licence file needs a copyright line, which puts a name in a
public file. Whose?

**Recommendation.** The founder's call: his name, or a neutral holder such as
"the stash2flow authors".

### Question: notification channel

`#question-notification-channel`

**Question.** Through which channel is the
[summary notification](domain-language.md#summary-notification) sent?

**Recommendation.** E-mail or a chat webhook; the founder picks. Counts only,
no file names and no text.

## Frontend and later steps

Background: [the four steps](mission.md#four-steps). A frontend is coming as its
own item, [FEATURE-003](../doing/BACKLOG.md). It is not built in the index, but it touches the index.
What is already settled about organizing is in
[how assets are organized and found](how-it-works.md#how-assets-are-organized-and-found).

### Question: duplicate report and frontend

`#question-duplicate-report-and-frontend`

**Question.** The [duplicate report](domain-language.md#duplicate-report) is
planned as a page of its own. It would become a screen of the frontend. Build it
anyway?

**Recommendation.** Keep the plain page. The frontend takes it over later; the
choices it stores ([keeper](domain-language.md#keeper),
[reviewed](domain-language.md#reviewed)) do not change.

### Question: antivirus scan

`#question-antivirus-scan`

**Question.** Is an [asset](domain-language.md#asset) checked by an antivirus
scan, and where does the [user](domain-language.md#user) see the warning for a
flagged asset?

**Recommendation.** Not in the index: the index runs no antivirus scan. Decide
it together with the frontend, because the place a warning matters is where the
[user](domain-language.md#user) opens or downloads an
[asset](domain-language.md#asset) on his own computer.

### Question: how an asset gets its context

`#question-how-an-asset-gets-its-context`

**Question.** How does an [asset](domain-language.md#asset) get its
[context](domain-language.md#context)? The [user](domain-language.md#user)
cannot confirm every asset one by one.

**Recommendation.** By rules first, from where the
[asset](domain-language.md#asset) came from: its
[source](domain-language.md#source), its folder, its
[sender](domain-language.md#sender). A local model proposes a
[context](domain-language.md#context) only for what the rules do not cover.

### Question: API for the frontend

`#question-api-for-the-frontend`

**Question.** The [API](domain-language.md#api) must serve a frontend, not only
the command line. Does the index need to build anything extra for that?

**Recommendation.** Nothing extra. Search and the report already go through the
[API](domain-language.md#api).

### Question: frontier model for the taxonomy

`#question-frontier-model-for-the-taxonomy`

**Question.** The founder wants a frontier model to help create a good
[taxonomy](domain-language.md#taxonomy). How may it help when no text of an
[asset](domain-language.md#asset) leaves the [user](domain-language.md#user)'s
network?

**Recommendation.** The [user](domain-language.md#user) designs the
[taxonomy](domain-language.md#taxonomy) in a conversation with a frontier
model, outside the app, from what he knows about his own life. The result is
private configuration. Local models then assign
[assets](domain-language.md#asset) to it.

### Question: clean copy format

`#question-clean-copy-format`

**Question.** Is the clean copy ([FEATURE-004](../backlog/BACKLOG.md)) plain
folders and files that can be read without the app,
or the app's own store?

**Recommendation.** None yet. To be settled before the clean copy is planned.
