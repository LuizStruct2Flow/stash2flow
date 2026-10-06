# Bugs — active

One row per bug being worked on. A row moves to `waiting-acceptance/` once its
fix is on `main` and CI is green.

| # | Bug | State |
|---|---|---|
| **BUG-001** | CI fails on a fresh clone of this repository. The framework's test suites read `.claude/settings.json` and `scripts/start-codex-signal-watch.mts`, and the project's `.gitignore` kept both out of the repository, so they exist on a developer's machine and are missing in CI. The local gate passes and CI fails. Fix: track both files; a project's own permission rules go in `.claude/settings.project.json`. **Reproducer: not applicable — a repository configuration fault, not a product or runtime bug.** **No regression test:** the framework's own suites are the test: they fail in CI whenever either file is missing from a clone. | Fix committed; waiting for CI |
| **BUG-002** | [SEC] The dependency scan blocks the push: `source-map-js` 1.2.1, pulled in by the test runner, has a published advisory (GHSA-68fv-2mgg-jv7q, high). Fix: update it to the patched 1.2.2 in `tests/package-lock.json`. That file comes from the blueprint, so the same update is requested there. **Reproducer: not applicable — a dependency advisory, not a product or runtime bug.** **No regression test:** the dependency scan in the gate and in CI is the test: it fails while the vulnerable version is locked. | Fix committed; waiting for CI |
