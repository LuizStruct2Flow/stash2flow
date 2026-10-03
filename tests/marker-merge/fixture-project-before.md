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

## Generic agent protocol — v1

This block was pulled from the blueprint at an earlier sync. v1 only
says: every push runs the pre-push gate. v2 (blueprint HEAD) tightens
this further. The pull must replace this v1 region with the v2 region
from fixture-blueprint.md.

<!-- BLUEPRINT:END -->

## Project-specific deploy notes — bottom

This project's deploy targets are different from every other
struct2flow project's. The notes here must NOT be replaced by the
blueprint's blueprint-only deploy notes.

Concrete deploy:
- prod: example-prod.com
- dev: example-dev.com
