# What stash2flow is for

What stash2flow is for and why it exists. Read this first if you want to know
what the app tries to achieve before reading how it does it. Every scope
decision in the other concept documents is judged against this one.

## Mission

`#mission`

**One clean, organized and curated copy of your digital life: only what
matters, and nothing else.**

- **One copy.** Today the same [file](domain-language.md#file) sits in several
  places. At the end there is one.
- **Organized.** Everything is arranged so it can be found, by browsing or by
  searching.
- **Curated.** The [user](domain-language.md#user) decides what matters. The app only proposes.

The test for any scope decision: does this help the [user](domain-language.md#user) end up with one copy,
organized, of only what matters?

## Digital trash

`#digital-trash`

Digital trash is what the app frees the [user](domain-language.md#user) from: the same [files](domain-language.md#file) in several
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

The founder's picture: many [sources](domain-language.md#source) are organized, deduplicated, cleansed and
saved in one organized database that is constantly updated and never grows fat.
New content goes through the same path every time, so the result is not a
one-off tidy-up.

The app gets there in four items, in this order:

| Step | Item | What it does | State |
|---|---|---|---|
| 1. Index | [FEATURE-001](../doing/BACKLOG.md) | Reads every [source](domain-language.md#source), keeps a local copy of each [file](domain-language.md#file) on the [server](domain-language.md#server), makes everything searchable by its text, and groups [duplicates](domain-language.md#duplicate). | Planned, no code yet |
| 2. Organize | [FEATURE-003](../doing/BACKLOG.md) | A frontend where everything is arranged by a taxonomy the [user](domain-language.md#user) shapes, plus a search over all content. | To be planned |
| 3. Clean copy | [FEATURE-004](../backlog/BACKLOG.md) | Writes the organized content to one place the [user](domain-language.md#user) chooses, and keeps it current. | Parked until the frontend is accepted |
| 4. Clean up | [FEATURE-002](../backlog/BACKLOG.md) | Removes what is unnecessary from the [sources](domain-language.md#source), only with the [user](domain-language.md#user)'s go and only when verified copies exist. | Parked until the clean copy exists |

The rest of the concept documents describe step 1, the index. It has four
goals:

1. **Find documents fast** by their text, type, [person](domain-language.md#person) and date. The first use
   case: find an official receipt filed more than ten years ago, whose file
   name says nothing and whose scan date is unknown.
2. **Find photos fast** by date and by what they show. The [place](domain-language.md#place) of a photo is
   stored, but searching by place is not part of this item.
3. **Group duplicates** across all [sources](domain-language.md#source): [exact](domain-language.md#exact) copies and the same image at
   another resolution or format.
4. **Stay current.** A [source](domain-language.md#source) is read again by itself 30 days after its last
   finished [run](domain-language.md#run).

How the index does this is in [how-it-works.md](how-it-works.md). The steps
that come after it leave open points in the index; they are listed in
[open-questions.md](open-questions.md#frontend-and-later-steps).

## Measuring before and after

`#measuring-before-and-after`

Nobody knows how much stored data is trash in general, but one case can be
measured: the [user](domain-language.md#user)'s own. The app measures it before and after.

- **Before.** The first full [run](domain-language.md#run) of each [source](domain-language.md#source) records how many [files](domain-language.md#file) and how
  many [bytes](domain-language.md#bytes) that source holds. Once [duplicates](domain-language.md#duplicate) are grouped, it records what
  share of them are duplicates. For [e-mail](domain-language.md#e-mail) it also records how many messages
  come from [senders](domain-language.md#sender) that end up on the
  [blacklist](domain-language.md#blacklist). These figures are kept unchanged
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
- **Not something that deletes by itself.** See
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
