# Fixture: the project's version BEFORE pull

This is what a downstream struct2flow project's copy of this file
looks like right before `blueprint pull` runs. The project's local
content lives outside the markers; the inside-marker region was
synced from the blueprint at an earlier time (v1 of the generic
agent protocol).

## Project-specific overrides — top

This project has its own pre-amble rule that lives ABOVE the
blueprint-managed region. It must survive the pull byte-identical:
no whitespace change, no character change.

<!-- BLUEPRINT:BEGIN -->

## Generic agent protocol — v2

This block is owned by the blueprint. v2 tightens the previous v1 rule
by adding a "release-notes lockstep" line. Every downstream project
should inherit this rule on the next `blueprint pull`.

Rule: any push that flips a user-visible feature flag also updates the
RELEASE-NOTES.md entry in the SAME commit. No separate notes-only
commit; the pre-push gate enforces it.

<!-- BLUEPRINT:END -->

## Project-specific deploy notes — bottom

This project's deploy targets are different from every other
struct2flow project's. The notes here must NOT be replaced by the
blueprint's blueprint-only deploy notes.

Concrete deploy:
- prod: example-prod.com
- dev: example-dev.com
