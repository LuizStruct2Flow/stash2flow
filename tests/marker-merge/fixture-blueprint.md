# Fixture: the blueprint's version (v2)

This fixture stands in for a real blueprint-managed file. It contains
ONE marker-bounded region. Anything outside the markers is what THIS
project (the blueprint) declares as its own content; anything inside
the markers is the generic content that gets synced into every
struct2flow project.

When the marker-aware merge runs in a downstream project, the
project's outside-marker content stays byte-identical and ONLY the
inside-marker region gets replaced with this file's inside-marker
region.

<!-- BLUEPRINT:BEGIN -->

## Generic agent protocol — v2

This block is owned by the blueprint. v2 tightens the previous v1 rule
by adding a "release-notes lockstep" line. Every downstream project
should inherit this rule on the next `blueprint pull`.

Rule: any push that flips a user-visible feature flag also updates the
RELEASE-NOTES.md entry in the SAME commit. No separate notes-only
commit; the pre-push gate enforces it.

<!-- BLUEPRINT:END -->

## Blueprint-only deploy notes

This section is part of THIS file in the blueprint repo only — every
downstream project replaces it with its own deploy notes. It's outside
the markers, so a marker-aware merge would leave the downstream
project's version untouched.
