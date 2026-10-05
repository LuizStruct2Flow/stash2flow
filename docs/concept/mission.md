# What stash2flow is for

What stash2flow is for and why it exists. Read this first if you want to know
what the app tries to achieve before reading how it does it. Every scope
decision in the other concept documents is judged against this one.

## Mission

`#mission`

**One clean, organized and curated copy of your digital life: only what
matters, and nothing else.**

- **One copy.** Today the same [asset](domain-language.md#asset) sits in several
  places. At the end there is one.
- **Organized.** Everything is arranged so it can be found, by browsing or by
  searching.
- **Curated.** The [user](domain-language.md#user) decides what matters. The app only proposes.

The test for any scope decision: does this help the [user](domain-language.md#user) end up with one copy,
organized, of only what matters?

## Digital trash

`#digital-trash`

Digital trash is what the app frees the [user](domain-language.md#user) from: the same files in several
cloud drives, photos in three resolutions, scans with names that say nothing,
and a mailbox that is mostly [advertisement](domain-language.md#advertisement). We keep it because storage is cheap
and sorting is not.

Nobody has measured how much stored data is trash. The public
[README](../../README.md) gives the estimates that exist and says plainly that
they are estimates. What is known is that the amount of data grows every year,
so the pile gets harder to sort the longer it is left.

The largest share is not known trash. It is data nobody has looked at. You
cannot curate what you cannot see, so the first thing the app does is make
everything visible and searchable.

## Four steps

`#four-steps`

Many [sources](domain-language.md#source) are organized, deduplicated, cleansed
and saved in one organized database that is constantly updated and never grows
fat. New content goes through the same path every time, so the result is not a
one-off tidy-up.

The path ends with one place to look for everything. The app is the single
source of truth for all the [user](domain-language.md#user)'s
[assets](domain-language.md#asset), and it keeps every
[source](domain-language.md#source) clean and thin. Cleaning up every mailbox
and drive one by one is very hard, so the user never has to: he looks in the
app, in one place.

The app gets there in four items, in this order:

| Step | Item | What it does | State |
|---|---|---|---|
| 1. Index | [FEATURE-001](../doing/BACKLOG.md) | Reads every [source](domain-language.md#source), keeps a [local copy](domain-language.md#local-copy) of each [asset](domain-language.md#asset) on the [server](domain-language.md#server), makes everything searchable by its text, groups [duplicates](domain-language.md#duplicate), and records which assets are [blacklisted](domain-language.md#blacklist). | Planned, no code yet |
| 2. Organize | [FEATURE-003](../doing/BACKLOG.md) | A frontend where every [asset](domain-language.md#asset) is arranged in a [taxonomy](domain-language.md#taxonomy) the [user](domain-language.md#user) shapes and carries [tags](domain-language.md#tag) that find it outside the taxonomy, plus a search over all content. | To be planned |
| 3. Clean copy | [FEATURE-004](../backlog/BACKLOG.md) | Writes the organized content to one place the [user](domain-language.md#user) chooses, and keeps it current. | Parked until the frontend is accepted |
| 4. Clean up | [FEATURE-002](../backlog/BACKLOG.md) | Moves what could be deleted from the [sources](domain-language.md#source) to the [quarantine](domain-language.md#quarantine): one for all sources, which the [user](domain-language.md#user) looks through in the app, in one place. There he restores an [asset](domain-language.md#asset) or deletes it permanently, and everything that stays for 30 days is deleted. What a model judged to be trash is listed in the same place and is moved to the quarantine only when he confirms it. An asset worth keeping is removed from a source only when verified copies exist. | Parked until the clean copy exists |

The rest of the concept documents describe step 1, the index. It has four
goals:

1. **Find documents fast** by their text, [doc_type](domain-language.md#doc_type), [persons](domain-language.md#person) and date. The first use
   case: find an official receipt filed more than ten years ago, whose file
   name says nothing and whose scan date is unknown.
2. **Find photos fast** by date and by what they show. The [place](domain-language.md#place) of a photo is
   stored, but searching by place is not part of this item.
3. **Group duplicates** across all [sources](domain-language.md#source): [exact](domain-language.md#exact) copies and the same image at
   another resolution or format.
4. **Stay current.** A [source](domain-language.md#source) is read again by itself 30 days after its last
   finished [run](domain-language.md#run).

How the index does this is in [how-it-works.md](how-it-works.md), and so is
[how assets are organized and found](how-it-works.md#how-assets-are-organized-and-found). The steps
that come after it leave open points in the index; they are listed in
[open-questions.md](open-questions.md#frontend-and-later-steps).

## Measuring before and after

`#measuring-before-and-after`

Nobody knows how much stored data is trash in general, but one case can be
measured: the [user](domain-language.md#user)'s own. The app measures it before and after.

- **Before.** The first full [run](domain-language.md#run) of each [source](domain-language.md#source) records how many [assets](domain-language.md#asset) and how
  many [bytes](domain-language.md#bytes) that source holds. Once [duplicates](domain-language.md#duplicate) are grouped, it records what
  share of them are duplicates. It also records how many assets are
  [blacklisted](domain-language.md#blacklist),
  [advertisements](domain-language.md#advertisement) included. These figures are kept unchanged
  afterwards. They are the [baseline](domain-language.md#baseline).
- **After.** The same figures, read again once the user has organized and
  cleaned up. This belongs to the later steps, not to the index.

The "before" can only be taken once, which is why recording it is part of the
index. The app tracks the figures locally and publishes nothing. A user who
wants to make his figures public does that himself.

Which figures exactly is still open:
[open question: baseline figures](open-questions.md#question-baseline-figures).

## What the app is not

`#what-the-app-is-not`

- **Not a one-off tidy-up.** New content goes through the same path every time.
- **Not something that deletes behind the [user](domain-language.md#user)'s
  back.** Whatever could be deleted waits 30 days in the
  [quarantine](domain-language.md#quarantine), where he can restore it. See
  [nothing is deleted without a go](principles.md#nothing-deleted-without-a-go).
- **Not a cloud service.** It is self-hosted and nothing leaves the user's
  network. See
  [private by construction](principles.md#private-by-construction).
- **Not dependent on a chat assistant.** The app runs by itself. Letting an
  assistant query the index is a later option and is not built in the index
  item.
- **Not a photo editor.**
- **Not a publisher of figures.** The [baseline](domain-language.md#baseline) stays on the [user](domain-language.md#user)'s [server](domain-language.md#server).
- **Not a plug-in system.** A new kind of [source](domain-language.md#source) is added as code, as described
  in [adding a source](sources.md#adding-a-source).
