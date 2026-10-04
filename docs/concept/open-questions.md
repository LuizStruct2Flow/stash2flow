# Open questions

Everything that still waits for the founder's ruling, in one place. Each
question states the point in one or two sentences and gives the
recommendation. Nothing here is decided; once a question is ruled, its answer
moves into the document it belongs to and the question is removed from this
one.

The other concept documents mark each open spot with a link to its question
here.

## Words

Concepts with no agreed word. They are described in
[words still to name](domain-language.md#words-still-to-name), with their
candidates. The feature files cannot be written before these are named.

### Question: name for reading a source

`#question-name-for-reading-a-source`

**Question.** What is the word for what a [puller](domain-language.md#puller)
and a [collector](domain-language.md#collector) have in common: the thing that
lists one [source](domain-language.md#source), reports its changes and hands
over [bytes](domain-language.md#bytes)?

**Candidates.** "puller" for both · "source reader" · no shared word.

**Recommendation.** None. The word is the founder's to choose.

### Question: name for what a run talks to

`#question-name-for-what-a-run-talks-to`

**Question.** What is the word for the thing a
[run](domain-language.md#run) talks to: it takes the
[file records](domain-language.md#file-record), keeps the
[cursor](domain-language.md#cursor) and the
[checkpoint](domain-language.md#checkpoint), says which
[files](domain-language.md#file) are unchanged and marks
[vanished](domain-language.md#vanished) files?

**Candidates.** "ingest" · two things, "ingest" and "cursor" · no word.

**Recommendation.** None. The word is the founder's to choose.

### Question: name for pipeline progress

`#question-name-for-pipeline-progress`

**Question.** What is the word for which
[pipeline](domain-language.md#pipeline) steps a
[file](domain-language.md#file) has completed, and with which model?

**Candidates.** "processed steps" · "pipeline state" · one timestamp per step
and no collective word.

**Recommendation.** None. The word is the founder's to choose.

### Question: name for a search entry

`#question-name-for-a-search-entry`

**Question.** What is one entry in a search answer called?

**Candidates.** "result" · "match".

**Recommendation.** None. The word is the founder's to choose.

### Question: name for the store of local copies

`#question-name-for-the-store-of-local-copies`

**Question.** What is the word for the place on the
[server](domain-language.md#server) where the local copies are kept? It used to
be the temp directory, which is no longer true.

**Candidates.** None proposed yet.

**Recommendation.** None. The word is the founder's to choose.

## E-mail

Background: [senders decide](sources.md#senders-decide).

### Question: whitelist and official senders

`#question-whitelist-and-official-senders`

**Question.** Is the [whitelist](domain-language.md#whitelist) the same list as
the earlier list of
[official senders](domain-language.md#official-sender-and-keyword), whose
[message bodies](domain-language.md#message-body) are indexed, or a second list
beside it?

**Recommendation.** One list. A whitelisted [sender](domain-language.md#sender)'s
[attachments](domain-language.md#attachment) and message body are both indexed.
[Keywords](domain-language.md#official-sender-and-keyword) then no longer decide
anything; a keyword match becomes one more hint when sorting senders.

### Question: unknown senders

`#question-unknown-senders`

**Question.** What happens to an [e-mail](domain-language.md#e-mail) from a
[sender](domain-language.md#sender) on neither list?

**Recommendation.** Nothing from that sender is indexed yet. The
[run](domain-language.md#run) summary lists the new senders, each with a count
and the [provider](domain-language.md#provider)'s hints as a suggested sorting,
and the [user](domain-language.md#user) puts each on one list. The first e-mail
run therefore starts with sorting senders, before anything is indexed. A sender
put on the [whitelist](domain-language.md#whitelist) has its earlier e-mails
indexed by the next run.

### Question: blacklisted after indexing

`#question-blacklisted-after-indexing`

**Question.** A [sender](domain-language.md#sender) is put on the
[blacklist](domain-language.md#blacklist) after some of its
[e-mails](domain-language.md#e-mail) were indexed. What happens to those?

**Recommendation.** Nothing new is indexed. What is already indexed stays until
the [user](domain-language.md#user) says otherwise.

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

## Duplicates

Background: [how duplicates work](how-it-works.md#duplicates).

### Question: one group per file

`#question-one-group-per-file`

**Question.** A [file](domain-language.md#file) could be in an
[exact](domain-language.md#exact) group and in a
[near](domain-language.md#near) group at the same time, but a file can point to
one group only. Which is it?

**Recommendation.** One group per [file](domain-language.md#file). Files showing
the same image are one group; it is [exact](domain-language.md#exact) when all
[bytes](domain-language.md#bytes) match, otherwise
[near](domain-language.md#near).

### Question: which hash decides exact

`#question-which-hash-decides-exact`

**Question.** Two hashes are computed on the
[bytes](domain-language.md#bytes), [md5 and sha256](domain-language.md#md5-and-sha256).
Which one decides that two [files](domain-language.md#file) are
[exact](domain-language.md#exact) [duplicates](domain-language.md#duplicate)?

**Recommendation.** [sha256](domain-language.md#md5-and-sha256) decides.
[md5](domain-language.md#md5-and-sha256) is stored because it is required.

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

## Search and dates

Background: [how search works](how-it-works.md#search).

### Question: date filter

`#question-date-filter`

**Question.** Which date do the date filters of search and of photo search
use?

**Recommendation.** For documents the [doc_date](domain-language.md#doc_date),
falling back to the [file_date](domain-language.md#file_date). For photos the
file_date. Known limit: a wrongly read doc_date hides the
[file](domain-language.md#file) from a date filter.

### Question: vanished in search

`#question-vanished-in-search`

**Question.** Do [vanished](domain-language.md#vanished)
[files](domain-language.md#file) show up in search?

**Recommendation.** Hidden by default and shown with a flag. The answer says
how many were left out.

### Question: several persons

`#question-several-persons`

**Question.** A document or a photo can concern several
[persons](domain-language.md#person). Does a [file](domain-language.md#file)
hold one person or several?

**Recommendation.** Several persons per [file](domain-language.md#file).

## Pipeline and models

Background: [pipeline steps](how-it-works.md#pipeline-steps).

### Question: which models

`#question-which-models`

**Question.** Which OCR engine, which
[description](domain-language.md#description) model and which
[embedding](domain-language.md#embedding) models?

**Recommendation.** Benchmark first. Slice 1 picks the OCR engine on a sample
of real [scans](domain-language.md#scan) and measures
[files](domain-language.md#file) per hour for OCR and both
[embeddings](domain-language.md#embedding). The description model is picked the
same way when descriptions are built. Candidates must run on the
[server](domain-language.md#server)'s hardware.

### Question: which files get OCR

`#question-which-files-get-ocr`

**Question.** OCR runs before the [kind](domain-language.md#kind) of a
[file](domain-language.md#file) is known. Which files get it?

**Recommendation.** Every image and every PDF without a
[text layer](domain-language.md#text-layer); videos never. If the measured
[files](domain-language.md#file) per hour make the first
[run](domain-language.md#run) too slow, the founder decides then whether photos
from iCloud Photos skip OCR.

### Question: kind rules

`#question-kind-rules`

**Question.** Three rules are not defined: how a screenshot is told from a
photo, how much text makes [has_text](domain-language.md#has_text) true, and
what "complete" photo metadata means for the
[keeper](domain-language.md#keeper) tie-break.

**Recommendation.** Settle them as examples in the slice-0 feature files, for
the founder's review.

## Local copies

Background: [local copy](principles.md#local-copy).

### Question: videos

`#question-videos`

**Question.** Videos may be large. Does the
[server](domain-language.md#server) keep a local copy of them too? Until this is
ruled, a video keeps only its metadata and
[provider hash](domain-language.md#provider-hash).

**Recommendation.** The first [run](domain-language.md#run) reports each
[source](domain-language.md#source)'s total size before it downloads anything,
and the founder decides about videos with real numbers.

### Question: disk encryption

`#question-disk-encryption`

**Question.** The [server](domain-language.md#server)'s disk will hold every
private document so it must be encrypted. When and how is that ensured?

**Recommendation.** Encrypt it before slice 2 of the plan, the first slice
that keeps [files](domain-language.md#file) on the server.

## Sources and collectors

Background: [the Mac collector](sources.md#mac-collector).

### Question: two collectors, one source

`#question-two-collectors-one-source`

**Question.** Two Macs can only see the same
[file](domain-language.md#file) if both read the same
[source](domain-language.md#source), but a source has one
[reader](domain-language.md#reader). What happens when a second
[collector](domain-language.md#collector) reports it?

**Recommendation.** A [source](domain-language.md#source) is unique by
[location](domain-language.md#location) and
[account](domain-language.md#account). The
[reader](domain-language.md#reader) is the machine that normally reads it.
[File records](domain-language.md#file-record) from another
[collector](domain-language.md#collector) for the same source update the same
row, and [collected_by](domain-language.md#collected_by) records who sent them.

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

### Question: authentication

`#question-authentication`

**Question.** Who must authenticate to the [API](domain-language.md#api) besides
the [collectors](domain-language.md#collector): the command line, the
[duplicate report](domain-language.md#duplicate-report) in a browser?

**Recommendation.** Everything authenticates. One token per client. HTTPS on
the local network.

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
no [file](domain-language.md#file) names and no text.

## Measuring

Background: [measuring before and after](mission.md#measuring-before-and-after).

### Question: baseline figures

`#question-baseline-figures`

**Question.** Which figures exactly make up the
[baseline](domain-language.md#baseline)?

**Recommendation.** Per [source](domain-language.md#source):
[files](domain-language.md#file), [bytes](domain-language.md#bytes),
[exact](domain-language.md#exact) [duplicates](domain-language.md#duplicate),
[near](domain-language.md#near) duplicates, and for
[e-mail](domain-language.md#e-mail) the blacklisted share. Overall: the number
of sources a file is found in.

## Order of work

### Question: e-mail slice order

`#question-e-mail-slice-order`

**Question.** [E-mail](domain-language.md#e-mail) is built early, before
descriptions and duplicates. Keep that order?

**Recommendation.** Keep it. The first use case may live only in an
[e-mail](domain-language.md#e-mail)
[attachment](domain-language.md#attachment).

## Frontend and later steps

Background: [the four steps](mission.md#four-steps). A frontend is coming as its
own item, [FEATURE-003](../doing/BACKLOG.md). It is not built in the index, but it touches the index in
three places.

### Question: duplicate report and frontend

`#question-duplicate-report-and-frontend`

**Question.** The [duplicate report](domain-language.md#duplicate-report) is
planned as a page of its own. It would become a screen of the frontend. Build it
anyway?

**Recommendation.** Keep the plain page. The frontend takes it over later; the
choices it stores ([keeper](domain-language.md#keeper),
[reviewed](domain-language.md#reviewed)) do not change.

### Question: taxonomy step

`#question-taxonomy-step`

**Question.** Sorting a [file](domain-language.md#file) into the taxonomy would
be a [pipeline](domain-language.md#pipeline) step next to the
[description](domain-language.md#description), and may replace
[doc_type](domain-language.md#doc_type) and
[person](domain-language.md#person). Does it?

**Recommendation.** Decide it with the frontend's plan, before the slice that
builds [descriptions](domain-language.md#description) starts, because that is
where [doc_type](domain-language.md#doc_type) and
[person](domain-language.md#person) are built. A new step can already be run
over [files](domain-language.md#file) that are indexed.

### Question: API for the frontend

`#question-api-for-the-frontend`

**Question.** The [API](domain-language.md#api) must serve a frontend, not only
the command line. Does the index need to build anything extra for that?

**Recommendation.** Nothing extra. Search and the report already go through the
[API](domain-language.md#api).

### Question: frontier model for the taxonomy

`#question-frontier-model-for-the-taxonomy`

**Question.** The founder wants a frontier model to help create a good
taxonomy. How may it help when no document text leaves the
[user](domain-language.md#user)'s network?

**Recommendation.** None yet. To be settled before the frontend is planned.

### Question: clean copy format

`#question-clean-copy-format`

**Question.** Is the clean copy ([FEATURE-004](../backlog/BACKLOG.md)) plain
folders and [files](domain-language.md#file) that can be read without the app,
or the app's own store?

**Recommendation.** None yet. To be settled before the clean copy is planned.
