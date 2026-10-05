# How it works

What happens to an asset from the moment a [source](domain-language.md#source) is
read until the [user](domain-language.md#user) finds it in a search or sees it
in the [duplicate report](domain-language.md#duplicate-report). Read this to
understand the app's behaviour; it describes the index, the first of the
[four steps](mission.md#four-steps), and says where the frontend adds to it.

## Runs

`#runs`

A [run](domain-language.md#run) is one pass over one
[source](domain-language.md#source). The first run of a source is full. Every
later run is incremental: it reads only what changed since the stored
[cursor](domain-language.md#cursor).

A [run](domain-language.md#run) only reads. It never writes to a
[source](domain-language.md#source).

For every [run](domain-language.md#run) the [server](domain-language.md#server)
records when it started and finished, how many [assets](domain-language.md#asset)
were new, changed and [vanished](domain-language.md#vanished), and its errors.
An asset that fails is recorded in the run's errors and the run goes on. The
[user](domain-language.md#user) can see a run's state and its errors.

When a [run](domain-language.md#run) finishes, a
[summary notification](domain-language.md#summary-notification) reports new
[assets](domain-language.md#asset), new [duplicates](domain-language.md#duplicate)
and errors. For a mailbox it also counts the
[advertisements](domain-language.md#advertisement) and the
[spam](domain-language.md#spam) it recorded, and the assets that are now
[blacklisted](domain-language.md#blacklist). Through which channel it is sent is open:
[open question: notification channel](open-questions.md#question-notification-channel).

## Starting a run

`#starting-a-run`

[Runs](domain-language.md#run) are started by the [user](domain-language.md#user),
and he can start one at any time. The first run of a
[source](domain-language.md#source) is always his.

A [run](domain-language.md#run) starts by itself in one case only: see
[thirty days](#thirty-days).

## Thirty days

`#thirty-days`

A [run](domain-language.md#run) starts by itself only when 30 days have passed
since that [source](domain-language.md#source)'s last finished run.

- The 30 days count per [source](domain-language.md#source). Running one source
  does not postpone the others.
- Only a finished [run](domain-language.md#run) moves the date. A run that
  failed or was interrupted does not.
- A [source](domain-language.md#source) with no finished
  [run](domain-language.md#run) does not start by itself.
- On the [server](domain-language.md#server) the
  [scheduler](domain-language.md#scheduler) starts the
  [run](domain-language.md#run). On a Mac the system's own scheduler
  (`launchd`) does, and a Mac that was asleep when its run was due runs when it
  wakes.

## Resuming

`#resuming`

The first [run](domain-language.md#run) of a
[source](domain-language.md#source) goes in batches and can be interrupted. It
resumes where it stopped, from the
[checkpoint](domain-language.md#checkpoint). Photos are read from the oldest to
the newest.

The rules that make this safe:

- The [server](domain-language.md#server) stores a batch of
  [asset records](domain-language.md#asset-record) and the position reached in one
  step, then acknowledges. The [puller](domain-language.md#puller) or
  [collector](domain-language.md#collector) moves on only after the
  acknowledgement.
- So the [cursor](domain-language.md#cursor) and the
  [checkpoint](domain-language.md#checkpoint) move only when every
  [asset record](domain-language.md#asset-record) up to them is stored.
- A batch delivered twice changes nothing, because
  [asset records](domain-language.md#asset-record) are stored by the
  [asset](domain-language.md#asset)'s identity.

## Unchanged assets

`#unchanged-assets`

A second [run](domain-language.md#run) with no changes downloads nothing and
processes nothing. Whether an [asset](domain-language.md#asset) is unchanged is
decided by one rule, applied on the [server](domain-language.md#server) when the
[asset record](domain-language.md#asset-record) arrives, against what the index
already holds:

1. Same [provider hash](domain-language.md#provider-hash): unchanged.
2. No [provider hash](domain-language.md#provider-hash), but same size and
   modification time: unchanged.
3. Otherwise the [sha256](domain-language.md#md5-and-sha256) decides. A
   [collector](domain-language.md#collector) computes it locally; the
   [server](domain-language.md#server) computes it after fetching the
   [bytes](domain-language.md#bytes).

An [asset](domain-language.md#asset) that shows a newer date but has the same hash
is an asset already read: its date is updated and no step of the
[pipeline](domain-language.md#pipeline) runs again.
A changed asset is processed again. An unchanged asset whose pipeline steps are
all done costs nothing.

The first [run](domain-language.md#run) fetches every
[asset](domain-language.md#asset) once, because the
[sha256](domain-language.md#md5-and-sha256) needs the
[bytes](domain-language.md#bytes). Later runs skip unchanged assets by the
[provider hash](domain-language.md#provider-hash).

## Vanished assets

`#vanished-assets`

An [asset](domain-language.md#asset) that is no longer in its
[source](domain-language.md#source) is
[vanished](domain-language.md#vanished). Its row stays in the index and its
`deleted_at` is set. Nothing is removed.

Whether [vanished](domain-language.md#vanished) assets show up in search is open:
[open question: vanished in search](open-questions.md#question-vanished-in-search).

## Whitelisted, blacklisted or neither

`#whitelisted-blacklisted-or-neither`

Every [asset](domain-language.md#asset), from every
[source](domain-language.md#source), is
[whitelisted](domain-language.md#whitelist),
[blacklisted](domain-language.md#blacklist) or neither yet. The verdict is on
the asset, never on a [sender](domain-language.md#sender) or a source as a
whole.

| Verdict | Meaning | How an [asset](domain-language.md#asset) gets it |
|---|---|---|
| [whitelisted](domain-language.md#whitelist) | kept | By default, from rules about where the asset came from. A personal [e-mail](domain-language.md#e-mail) from a family member is usually whitelisted, and so is a photo from the [user](domain-language.md#user)'s phone. It is a default, not a guarantee. |
| [blacklisted](domain-language.md#blacklist) | trash | Clear-cut. By a rule: an [advertisement](domain-language.md#advertisement) that arrived more than one week ago, and an [e-mail](domain-language.md#e-mail) whose [mail_label](domain-language.md#mail_label) says spam. Because a model judged it: [spam](domain-language.md#spam) that came through, which no mail_label marks. |
| neither | not judged yet | Everything else, for example an invoice from an online shop, or an advertisement in its week of validity. |

- The week of validity of an
  [advertisement](domain-language.md#advertisement) is a rule in code: one week
  after it arrived, whether or not the [user](domain-language.md#user) was
  interested.
- An [e-mail](domain-language.md#e-mail) with an attached PDF is never
  [blacklisted](domain-language.md#blacklist) by its
  [mail_label](domain-language.md#mail_label) alone.
- The index only records the verdict. It deletes nothing and moves nothing.
- Whatever could be deleted is moved to the
  [quarantine](domain-language.md#quarantine): one for all
  [sources](domain-language.md#source), which the
  [user](domain-language.md#user) looks through in the app, in one place. There
  he restores an [asset](domain-language.md#asset) or deletes it permanently,
  and everything in it is deleted after 30 days unless it is restored.
- An [asset](domain-language.md#asset)
  [blacklisted](domain-language.md#blacklist) because a model judged it is not
  moved to the [quarantine](domain-language.md#quarantine) by that verdict. The
  same one place lists it for the [user](domain-language.md#user) as something
  a model thinks is trash. When he confirms it, it is moved to the quarantine
  and follows the 30 days like everything else.
- Moving an [asset](domain-language.md#asset) to the
  [quarantine](domain-language.md#quarantine) writes to a
  [source](domain-language.md#source), so it belongs to clean-up
  ([FEATURE-002](../backlog/BACKLOG.md)), which is parked:
  [nothing deleted without a go](principles.md#nothing-deleted-without-a-go).

Open points: which rules make an [asset](domain-language.md#asset) whitelisted
by default
([open question: whitelisted by default](open-questions.md#question-whitelisted-by-default)),
where an asset in the [quarantine](domain-language.md#quarantine) physically
sits until it is deleted
([open question: where the quarantine is](open-questions.md#question-where-the-quarantine-is)),
whether a whitelisted asset can still reach it
([open question: whitelisted asset in the quarantine](open-questions.md#question-whitelisted-asset-in-the-quarantine)),
and what happens to an [e-mail](domain-language.md#e-mail) with an attached PDF
whose [mail_label](domain-language.md#mail_label) says promotions or spam
([open question: e-mail with an attached PDF](open-questions.md#question-e-mail-with-an-attached-pdf)).

## Pipeline steps

`#pipeline-steps`

An [e-mail](domain-language.md#e-mail) is first told apart: is it an
[advertisement](domain-language.md#advertisement),
[spam](domain-language.md#spam) or neither? Its
[mail_label](domain-language.md#mail_label) decides first: promotions makes it
an advertisement, spam makes it spam. An unsubscribe header alone decides
nothing. A model is asked only about an e-mail that no mail_label marks, to
find spam that came through. An advertisement or spam stops there:
its [sender](domain-language.md#sender), subject, date and mail_label are
recorded, and it gets no [local copy](domain-language.md#local-copy), no
[description](domain-language.md#description) and no further step.
The rules are in
[each e-mail is judged by what it is](sources.md#each-e-mail-is-judged-by-what-it-is).

Every other [asset](domain-language.md#asset) goes through the same
[pipeline](domain-language.md#pipeline), in this order:

1. **[Discovery](domain-language.md#discovery).**
   [Pullers](domain-language.md#puller) and
   [collectors](domain-language.md#collector) list their
   [sources](domain-language.md#source) and send
   [asset records](domain-language.md#asset-record) to the
   [server](domain-language.md#server).
2. **Unchanged?** The rule in [unchanged assets](#unchanged-assets). An unchanged
   [asset](domain-language.md#asset) stops here.
3. **[Bytes](domain-language.md#bytes).** The
   [asset](domain-language.md#asset)'s bytes are brought to the
   [server](domain-language.md#server) and kept in the
   [stash](domain-language.md#stash) as its
   [local copy](domain-language.md#local-copy).
4. **Hashes.** [md5 and sha256](domain-language.md#md5-and-sha256) on the
   [bytes](domain-language.md#bytes); the
   [provider hash](domain-language.md#provider-hash) is stored too.
   For an image, the [phash](domain-language.md#phash); for a PDF, the phash
   of its rendered first page.
5. **Metadata.**
   - Images: the date taken, the coordinates, the camera, the dimensions.
   - PDFs: the creation date, the program that made it (which identifies a
     scanner), the page count.
   - Photos from iCloud Photos: the library's id, date,
     [place](domain-language.md#place), albums,
     [persons](domain-language.md#person) and favorites.
   - The raw metadata of the [source](domain-language.md#source) is kept as it
     is.
   - From these the [asset_date](domain-language.md#asset_date) is chosen: the
     best available date, with a note of where it came from.
6. **Text.** A PDF with a [text layer](domain-language.md#text-layer) is not
   sent to OCR. Otherwise the pages are rendered and read. The
   [OCR text](domain-language.md#ocr-text) is stored per page in its original
   language. Exactly which [assets](domain-language.md#asset) are read is open:
   [open question: which assets get OCR](open-questions.md#question-which-assets-get-ocr).
7. **[Kind](domain-language.md#kind).** [has_text](domain-language.md#has_text)
   is set from the amount of [OCR text](domain-language.md#ocr-text), and the
   kind of the [asset](domain-language.md#asset) is decided.
   The exact rules are open:
   [open question: kind rules](open-questions.md#question-kind-rules).
8. **[Description](domain-language.md#description).** Only for an
   [asset](domain-language.md#asset) of [kind](domain-language.md#kind)
   `document`. A local model writes
   one English line from the [OCR text](domain-language.md#ocr-text), keeping
   proper names verbatim. It also
   extracts the [doc_date](domain-language.md#doc_date), the
   [doc_type](domain-language.md#doc_type), the
   [persons](domain-language.md#person) the document is about and the
   [issuer](domain-language.md#issuer). The doc_type always comes from the
   vocabulary: `id`, `tax`, `invoice`, `contract`, `certificate`,
   `bank_statement`, `insurance`, `medical`, `receipt`, `letter`, `other`.
9. **[Embeddings](domain-language.md#embedding).** One embedding for each
   photo, so a query like "beach" finds it. One over the
   [OCR text](domain-language.md#ocr-text), with a model
   that works across languages, so English words find a document written in
   another language.
10. **[Duplicates](domain-language.md#duplicate).** The
    [asset](domain-language.md#asset) is grouped with the assets that are the same.
    See [below](#duplicates).

**Videos** get their metadata and no OCR. They are not fetched: only their
[provider hash](domain-language.md#provider-hash) is stored, so the same video
at two different [providers](domain-language.md#provider) is not recognised as
an [exact](domain-language.md#exact) duplicate. Whether videos are copied to the
[server](domain-language.md#server) after all, which would close that gap, is
open:
[open question: videos](open-questions.md#question-videos).

Every step that uses a model uses a local one:
[local models only](principles.md#local-models-only). Which models is open:
[open question: which models](open-questions.md#question-which-models).

## Steps added later

`#steps-added-later`

The [pipeline](domain-language.md#pipeline) grows over time: a step may be added
when [assets](domain-language.md#asset) are already indexed. So:

- Each [asset](domain-language.md#asset) records its [completed steps](domain-language.md#completed-steps) and,
  for a step done by a model, which model.
- An ordinary [run](domain-language.md#run) processes an
  [asset](domain-language.md#asset) only when it is new or changed.
- When a step or a model is added, existing
  [assets](domain-language.md#asset) get it **only when the
  [user](domain-language.md#user) asks**.
- Nothing is downloaded a second time for this.
  [Description](domain-language.md#description) and text
  [embedding](domain-language.md#embedding) need only the stored
  [OCR text](domain-language.md#ocr-text); everything else reads the
  [local copy](domain-language.md#local-copy).

## What the index holds

`#what-the-index-holds`

| About | What is kept |
|---|---|
| Each [source](domain-language.md#source) | [location](domain-language.md#location), [account](domain-language.md#account), [reader](domain-language.md#reader), [cursor](domain-language.md#cursor), [checkpoint](domain-language.md#checkpoint), whether it is enabled, when its last [run](domain-language.md#run) finished, its rank in the [order of sources](domain-language.md#order-of-sources) |
| Each [asset](domain-language.md#asset) | its identity; path, name and [ext](domain-language.md#ext); size and modification time; [asset_date](domain-language.md#asset_date) and where it came from; the hashes; [kind](domain-language.md#kind) and [has_text](domain-language.md#has_text); [description](domain-language.md#description), [doc_type](domain-language.md#doc_type), [doc_date](domain-language.md#doc_date), [issuer](domain-language.md#issuer); its [persons](domain-language.md#person), which are [tags](domain-language.md#tag), so there can be several; coordinates, dimensions, page count; [source_link](domain-language.md#source_link); for an [e-mail](domain-language.md#e-mail) and an [attachment](domain-language.md#attachment) the [sender](domain-language.md#sender), subject, thread and [mail_label](domain-language.md#mail_label); whether it is [whitelisted](domain-language.md#whitelist), [blacklisted](domain-language.md#blacklist) or neither; the raw metadata; which machine sent it; its [duplicate group](domain-language.md#duplicate-group); when it was first and last seen, and when it [vanished](domain-language.md#vanished) |
| Text | the [OCR text](domain-language.md#ocr-text) per page, searchable without accents and tolerant of misreadings |
| [Embeddings](domain-language.md#embedding) | per [asset](domain-language.md#asset), with the name of the model that made them |
| Each [duplicate group](domain-language.md#duplicate-group) | [exact](domain-language.md#exact) or [near](domain-language.md#near), the [keeper](domain-language.md#keeper), [reviewed](domain-language.md#reviewed) or not |
| Each [run](domain-language.md#run) | start, finish, counts of new, changed and [vanished](domain-language.md#vanished) [assets](domain-language.md#asset), errors |
| Each [advertisement](domain-language.md#advertisement) and each [spam](domain-language.md#spam) e-mail | only its [sender](domain-language.md#sender), subject, date and [mail_label](domain-language.md#mail_label), and whether it is [blacklisted](domain-language.md#blacklist) |
| The [user](domain-language.md#user)'s choices | the [order of sources](domain-language.md#order-of-sources), [keepers](domain-language.md#keeper) and [reviewed](domain-language.md#reviewed) groups, the rules that make an [asset](domain-language.md#asset) [whitelisted](domain-language.md#whitelist) by default |
| The [baseline](domain-language.md#baseline) | see [measuring before and after](mission.md#measuring-before-and-after) |

## Duplicates

`#duplicates`

[Assets](domain-language.md#asset) that are the same form a
[duplicate group](domain-language.md#duplicate-group), across all
[sources](domain-language.md#source) and [accounts](domain-language.md#account).

| Group | Meaning | Example |
|---|---|---|
| [exact](domain-language.md#exact) | the same [bytes](domain-language.md#bytes) | an [attachment](domain-language.md#attachment) that also exists in a cloud drive |
| [near](domain-language.md#near) | the same image at another resolution or in another format | a photo and the copy a messenger compressed; a HEIC photo and its exported JPG |

- [Near](domain-language.md#near) is decided by the distance between two
  [phash](domain-language.md#phash) values, against a threshold that is
  configurable.
- Different photos are not grouped.
- A group keeps its id when [assets](domain-language.md#asset) join it.
- [Assets](domain-language.md#asset) in a
  [shared account](domain-language.md#shared-account) are flagged as also
  belonging to someone else.
- [Near](domain-language.md#near)
  [duplicates](domain-language.md#duplicate) across
  [sources](domain-language.md#source) are expected from the first day, for
  example when a cloud drive holds a partial copy of a photo library.

Open points: which hash decides [exact](domain-language.md#exact)
([open question: hash for exact](open-questions.md#question-which-hash-decides-exact)),
whether an [asset](domain-language.md#asset) can be in two groups at once
([open question: one group per asset](open-questions.md#question-one-group-per-asset)),
and [near](domain-language.md#near) matching of PDFs
([open question: near matching of PDFs](open-questions.md#question-near-matching-pdfs)).

## Choosing the keeper

`#choosing-the-keeper`

The [user](domain-language.md#user)'s
[order of sources](domain-language.md#order-of-sources) decides the
[keeper](domain-language.md#keeper).

1. The [user](domain-language.md#user) sets the
   [order of his sources](domain-language.md#order-of-sources) once.
2. In each [duplicate group](domain-language.md#duplicate-group), the
   [asset](domain-language.md#asset) from the highest-ranked
   [source](domain-language.md#source) is suggested as the
   [keeper](domain-language.md#keeper).
3. If that [source](domain-language.md#source) has several
   [assets](domain-language.md#asset) in the group, the tie goes to the highest
   resolution, then to complete photo metadata, then to the oldest.
4. The [user](domain-language.md#user) can change the
   [keeper](domain-language.md#keeper) of any group.
5. Nothing counts as chosen until the [user](domain-language.md#user) marks the
   group [reviewed](domain-language.md#reviewed).
6. When a new [asset](domain-language.md#asset) joins a group he already
   [reviewed](domain-language.md#reviewed), the group goes back to not reviewed,
   and his earlier [keeper](domain-language.md#keeper) stays as the suggestion.

The [order of sources](domain-language.md#order-of-sources) is stored in the
database with the [sources](domain-language.md#source), so the backup covers it.

## Reviewing duplicates

`#reviewing-duplicates`

The [duplicate report](domain-language.md#duplicate-report) is a web page,
opened with `stash dups --report`. It shows each group with thumbnails and
paths side by side, the suggested [keeper](domain-language.md#keeper), and the
flag for [assets](domain-language.md#asset) in a
[shared account](domain-language.md#shared-account). The thumbnails are kept on
the [server](domain-language.md#server).

The page takes two changes from the [user](domain-language.md#user): the
[keeper](domain-language.md#keeper) of a group, and
[reviewed](domain-language.md#reviewed). It refuses a change without valid
credentials.

The [report](domain-language.md#duplicate-report) only reports. Nothing is
deleted or moved. Whether [non-keepers](domain-language.md#non-keeper) may be
moved aside is open:
[open question: moving non-keepers](open-questions.md#question-moving-non-keepers).
How the report relates to the coming frontend is open too:
[open question: duplicate report and frontend](open-questions.md#question-duplicate-report-and-frontend).

## How assets are organized and found

`#how-assets-are-organized-and-found`

An [asset](domain-language.md#asset) is described from three independent
angles:

| Angle | What it says about an asset | How many | Examples |
|---|---|---|---|
| [context](domain-language.md#context) | the overall situation in the [user](domain-language.md#user)'s life in which the [asset](domain-language.md#asset) is embedded | one or more | personal, professional, a family album |
| [tag](domain-language.md#tag) | who or what the [asset](domain-language.md#asset) is about | several | a [person](domain-language.md#person), a [place](domain-language.md#place) such as a country, a tag the [user](domain-language.md#user) made |
| [doc_type](domain-language.md#doc_type) | what kind of document it is | one, and only for an [asset](domain-language.md#asset) of [kind](domain-language.md#kind) `document` | `tax`, `invoice`, `contract` |

- The [contexts](domain-language.md#context) form a tree, the
  [taxonomy](domain-language.md#taxonomy). It is the one structure that
  organizes the [assets](domain-language.md#asset), and the
  [user](domain-language.md#user) shapes it. A team is a context, not a list of
  [persons](domain-language.md#person).
- [Tags](domain-language.md#tag) cut across the
  [taxonomy](domain-language.md#taxonomy): they find
  [assets](domain-language.md#asset) outside of it. An asset can have several
  [persons](domain-language.md#person), such as a photo with several people or
  a document relevant for two people.
- The [context](domain-language.md#context) says which part of the
  [user](domain-language.md#user)'s life an
  [asset](domain-language.md#asset) belongs to; the
  [doc_type](domain-language.md#doc_type) says which kind of paper it is. The
  same fact is never held in both.
- Browsing is a combination, not one fixed path: the
  [user](domain-language.md#user) narrows by
  [context](domain-language.md#context), [tag](domain-language.md#tag) and
  [doc_type](domain-language.md#doc_type) in any order.
- What a photo shows is not a [tag](domain-language.md#tag). No model writes a
  tag for everything it sees. A photo of a beach is found by search, which
  compares the [user](domain-language.md#user)'s words with what the photo
  shows, through its [embedding](domain-language.md#embedding). Tags are for
  what search cannot know or what the user decides deliberately.

Who builds what:

- **The index** builds the [doc_type](domain-language.md#doc_type), the
  [persons](domain-language.md#person) (they come with a document's
  [description](domain-language.md#description) and from the photo library),
  and the search over text and over what a photo shows.
- **The frontend** brings the [taxonomy](domain-language.md#taxonomy), the
  [contexts](domain-language.md#context), the
  [tags](domain-language.md#tag) the [user](domain-language.md#user) makes, and
  browsing.

This split still waits for a ruling:
[open question: which step builds what](open-questions.md#question-which-step-builds-what).
How an [asset](domain-language.md#asset) gets its
[context](domain-language.md#context) is open too:
[open question: how an asset gets its context](open-questions.md#question-how-an-asset-gets-its-context).

## Search

`#search`

Search is served by the [API](domain-language.md#api) and used through a thin
command line, `stash`.

| Command | Finds |
|---|---|
| `stash search "<words>"` | [assets](domain-language.md#asset) by their text |
| `stash search --doc-type tax --person <name> --from 2005 --to 2015` | documents by [doc_type](domain-language.md#doc_type), [person](domain-language.md#person) and date range |

A [person](domain-language.md#person) is a [tag](domain-language.md#tag), so a
document with several persons is found under each of them.

How text search behaves:

- A [scan](domain-language.md#scan) with no
  [text layer](domain-language.md#text-layer) is found by its
  [OCR text](domain-language.md#ocr-text).
- Accents are ignored: "certidao" finds "Certidão".
- OCR misreadings are tolerated: "recibo" finds a page read as "rec1bo".
- A query in another language finds the document: English words find a
  Portuguese receipt. This combines matching the text with the
  [embedding](domain-language.md#embedding) of the
  [OCR text](domain-language.md#ocr-text).
- Every [match](domain-language.md#match) carries a
  [source_link](domain-language.md#source_link).

Open points: which date the date range filters on
([open question: date filter](open-questions.md#question-date-filter)) and
whether [vanished](domain-language.md#vanished) assets are shown
([open question: vanished in search](open-questions.md#question-vanished-in-search)).

## Finding photos

`#finding-photos`

| Command | Finds |
|---|---|
| `stash photos --date 2024-07` | photos by month |
| `stash photos --query "beach"` | photos by what they show, even when the name says nothing |

Albums, [persons](domain-language.md#person), favorites and
[place](domain-language.md#place) from iCloud Photos are kept with each
photo. Place is stored but not searchable in the index item.
