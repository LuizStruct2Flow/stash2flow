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
[domain-language.md](domain-language.md#words-still-to-name), with their
candidates. The feature files cannot be written before these are named.

### Question: name for reading a source

`#question-name-for-reading-a-source`

**Question.** What is the word for what a puller and a collector have in
common: the thing that lists one source, reports its changes and hands over
bytes?

**Candidates.** "puller" for both · "source reader" · no shared word.

**Recommendation.** None. The word is the founder's to choose.

### Question: name for what a run talks to

`#question-name-for-what-a-run-talks-to`

**Question.** What is the word for the thing a run talks to: it takes the file
records, keeps the cursor and the checkpoint, says which files are unchanged
and marks vanished files?

**Candidates.** "ingest" · two things, "ingest" and "cursor" · no word.

**Recommendation.** None. The word is the founder's to choose.

### Question: name for pipeline progress

`#question-name-for-pipeline-progress`

**Question.** What is the word for which pipeline steps a file has completed,
and with which model?

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

**Question.** What is the word for the place on the server where the local
copies are kept? It used to be the temp directory, which is no longer true.

**Candidates.** None proposed yet.

**Recommendation.** None. The word is the founder's to choose.

## E-mail

Background: [#senders-decide](sources.md#senders-decide).

### Question: whitelist and official senders

`#question-whitelist-and-official-senders`

**Question.** Is the whitelist the same list as the earlier list of official
senders, whose message bodies are indexed, or a second list beside it?

**Recommendation.** One list. A whitelisted sender's attachments and message
body are both indexed. Keywords then no longer decide anything; a keyword match
becomes one more hint when sorting senders.

### Question: unknown senders

`#question-unknown-senders`

**Question.** What happens to an e-mail from a sender on neither list?

**Recommendation.** Nothing from that sender is indexed yet. The run summary
lists the new senders, each with a count and the provider's hints as a
suggested sorting, and the user puts each on one list. The first e-mail run
therefore starts with sorting senders, before anything is indexed. A sender put
on the whitelist has its earlier e-mails indexed by the next run.

### Question: blacklisted after indexing

`#question-blacklisted-after-indexing`

**Question.** A sender is put on the blacklist after some of its e-mails were
indexed. What happens to those?

**Recommendation.** Nothing new is indexed. What is already indexed stays until
the user says otherwise.

### Question: attachment id

`#question-attachment-id`

**Question.** An attachment's id is the message's id plus the attachment's id,
but the provider's attachment id may not be stable between calls. And no id is
defined for a message body.

**Recommendation.** Verify it when e-mail is built. If it is unstable, use the
message's id plus the attachment's part number. For a body: the message's id
plus "body".

## Duplicates

Background: [#duplicates](how-it-works.md#duplicates).

### Question: one group per file

`#question-one-group-per-file`

**Question.** A file could be in an exact group and in a near group at the same
time, but a file can point to one group only. Which is it?

**Recommendation.** One group per file. Files showing the same image are one
group; it is exact when all bytes match, otherwise near.

### Question: which hash decides exact

`#question-which-hash-decides-exact`

**Question.** Two hashes are computed on the bytes, md5 and sha256. Which one
decides that two files are exact duplicates?

**Recommendation.** sha256 decides. md5 is stored because it is required.

### Question: near matching PDFs

`#question-near-matching-pdfs`

**Question.** Near matching of PDFs compares the first page. Two different
letters on the same letterhead may then match. Is that acceptable?

**Recommendation.** Measure it on fixtures when duplicates are built. If it
happens, near groups are limited to images and PDFs match only exactly.

### Question: moving non-keepers

`#question-moving-non-keepers`

**Question.** Should the index item be able to move non-keepers into a review
folder inside their source, after confirmation? It would be the only write to a
source.

**Recommendation.** No. The index reports only. Moving is a later item with its
own specifications.

## Search and dates

Background: [#search](how-it-works.md#search).

### Question: date filter

`#question-date-filter`

**Question.** Which date do the date filters of search and of photo search
use?

**Recommendation.** For documents the doc_date, falling back to the file_date.
For photos the file_date. Known limit: a wrongly read doc_date hides the file
from a date filter.

### Question: vanished in search

`#question-vanished-in-search`

**Question.** Do vanished files show up in search?

**Recommendation.** Hidden by default and shown with a flag. The answer says
how many were left out.

### Question: several persons

`#question-several-persons`

**Question.** A document or a photo can concern several persons. Does a file
hold one person or several?

**Recommendation.** Several persons per file.

## Pipeline and models

Background: [#pipeline-steps](how-it-works.md#pipeline-steps).

### Question: which models

`#question-which-models`

**Question.** Which OCR engine, which description model and which embedding
models?

**Recommendation.** Benchmark first. Slice 1 picks the OCR engine on a sample
of real scans and measures files per hour for OCR and both embeddings. The
description model is picked the same way when descriptions are built.
Candidates must run on the server's hardware.

### Question: which files get OCR

`#question-which-files-get-ocr`

**Question.** OCR runs before the kind of a file is known. Which files get it?

**Recommendation.** Every image and every PDF without a text layer; videos
never. If the measured files per hour make the first run too slow, the founder
decides then whether photos from iCloud Photos skip OCR.

### Question: kind rules

`#question-kind-rules`

**Question.** Three rules are not defined: how a screenshot is told from a
photo, how much text makes has_text true, and what "complete" photo metadata
means for the keeper tie-break.

**Recommendation.** Settle them as examples in the slice-0 feature files, for
the founder's review.

## Local copies

Background: [#local-copy](principles.md#local-copy).

### Question: videos

`#question-videos`

**Question.** Videos may be large. Does the server keep a local copy of them
too? Until this is ruled, a video keeps only its metadata and provider hash.

**Recommendation.** The first run reports each source's total size before it
downloads anything, and the founder decides about videos with real numbers.

### Question: disk encryption

`#question-disk-encryption`

**Question.** The server's disk will hold every private document and is not
encrypted today. When and how is it encrypted?

**Recommendation.** Encrypt it before slice 2 of the plan, the first slice
that keeps files on the server.

## Sources and collectors

Background: [#mac-collector](sources.md#mac-collector).

### Question: two collectors, one source

`#question-two-collectors-one-source`

**Question.** Two Macs can only see the same file if both read the same source,
but a source has one owner. What happens when a second collector reports it?

**Recommendation.** A source is unique by location and account. The owner says
who normally reads it. File records from another collector for the same source
update the same row, and collected_by records who sent them.

### Question: photo originals

`#question-photo-originals`

**Question.** When a Mac is set to keep only small versions of its photos, the
originals are not on the Mac. How does the collector get the bytes?

**Recommendation.** The collector asks `osxphotos` to download the original.
Confirm the Mac's setting before the collector is built.

## Server and security

Background: [infrastructure.md](infrastructure.md).

### Question: server setup

`#question-server-setup`

**Question.** How are the server's parts (database, API, workers, timer)
installed and kept running?

**Recommendation.** Scripted in `infra/` as system services rather than
containers, because the models need the machine's hardware. Settled in slice 1.
The machine can be rebuilt from the repository.

### Question: authentication

`#question-authentication`

**Question.** Who must authenticate to the API besides the collectors: the
command line, the duplicate report in a browser?

**Recommendation.** Everything authenticates. One token per client. HTTPS on
the local network.

### Question: public repository check

`#question-public-repository-check`

**Question.** How is it checked that no account data reaches the public
repository?

**Recommendation.** A check in the gate that refuses a push whose tracked files
contain any value from the private configuration (account addresses, person
names, senders). It lands in slice 1, before the first source is wired.

### Question: backup transport

`#question-backup-transport`

**Question.** The server runs Linux and iCloud has no client for it. How does
the backup get to iCloud?

**Recommendation.** The script writes one encrypted, dated file per run. A Mac
fetches it from the server into a folder of its iCloud Drive, and macOS uploads
it. That folder is left out of the index, because iCloud Drive is also a
source. Not recommended: a tool that writes to iCloud straight from the server,
because its login has to be renewed by hand.

### Question: copyright line

`#question-copyright-line`

**Question.** The licence file needs a copyright line, which puts a name in a
public file. Whose?

**Recommendation.** The founder's call: his name, or a neutral holder such as
"the stash2flow authors".

### Question: notification channel

`#question-notification-channel`

**Question.** Through which channel is the summary notification sent?

**Recommendation.** E-mail or a chat webhook; the founder picks. Counts only,
no file names and no text.

## Measuring

Background: [#measuring-before-and-after](mission.md#measuring-before-and-after).

### Question: baseline figures

`#question-baseline-figures`

**Question.** Which figures exactly make up the baseline?

**Recommendation.** Per source: files, bytes, exact duplicates, near
duplicates, and for e-mail the blacklisted share. Overall: the number of
sources a file is found in.

## Order of work

### Question: e-mail slice order

`#question-e-mail-slice-order`

**Question.** E-mail is built early, before descriptions and duplicates. Keep
that order?

**Recommendation.** Keep it. The first use case may live only in an e-mail
attachment.

## Frontend and later steps

Background: [#four-steps](mission.md#four-steps). A frontend is coming as its
own item, [FEATURE-003](../doing/BACKLOG.md) (decided by the founder on
3 October 2026). It is not built in the index, but it touches the index in
three places.

### Question: duplicate report and frontend

`#question-duplicate-report-and-frontend`

**Question.** The duplicate report is planned as a page of its own. It would
become a screen of the frontend. Build it anyway?

**Recommendation.** Keep the plain page. The frontend takes it over later; the
choices it stores (keeper, reviewed) do not change.

### Question: taxonomy step

`#question-taxonomy-step`

**Question.** Sorting a file into the taxonomy would be a pipeline step next to
the description, and may replace doc_type and person. Does it?

**Recommendation.** Decide it with the frontend's plan, before the slice that
builds descriptions starts, because that is where doc_type and person are
built. A new step can already be run over files that are indexed.

### Question: API for the frontend

`#question-api-for-the-frontend`

**Question.** The API must serve a frontend, not only the command line. Does
the index need to build anything extra for that?

**Recommendation.** Nothing extra. Search and the report already go through the
API.

### Question: frontier model for the taxonomy

`#question-frontier-model-for-the-taxonomy`

**Question.** The founder wants a frontier model to help create a good
taxonomy. How may it help when no document text leaves the user's network?

**Recommendation.** None yet. To be settled before the frontend is planned.

### Question: clean copy format

`#question-clean-copy-format`

**Question.** Is the clean copy ([FEATURE-004](../backlog/BACKLOG.md)) plain
folders and files that can be read without the app, or the app's own store?

**Recommendation.** None yet. To be settled before the clean copy is planned.
