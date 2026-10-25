# Changelog

Dated record of notable changes, newest on top: what changed and why.
Changes up to v0.1.0 are in the git history.

## Unreleased

**Intent:** the bounds job ran complex-md 0.10.0 after 0.11.0 was on npm
(published 2026-10-25), and `verify: true` warned and checked nothing,
because 0.10.0 has no verify command
([issue #1](https://github.com/KletoWorks/complex-md-action/issues/1)).

**Change:** the CLI pin is complex-md 0.11.0, with the sha512 integrity
that npm published. `verify: true` now runs `complex-md verify` and fails
the job when it exits 1 (drift past tolerance) or 2 (cannot verify). A
test downloads the pinned tarball, checks it against the pin and runs its
`--help` with no dependency installed. Dependabot opens a pull request for
each complex-md release, and a test fails on it until `src/cli.js` pins
the same version.
