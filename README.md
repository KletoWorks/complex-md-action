# complex-md-action

A pull request that edits a file changed in 17 commits, 4 of them bug
fixes, looks the same in review as one that fixes a typo. So does a pull
request that changes `README.md` and leaves `bench/RESULTS.md` alone,
although the two changed together in 4 commits, at 80 percent coupling.

[COMPLEX.md](https://complex.md/spec) already records both facts: the
hotspots, the load bearing files and the co-change pairs, computed from the
repository's own history. This action puts them in front of the reviewer.
When a pull request touches a hotspot or a load bearing file, or changes one
side of a co-change pair and not the other, it posts one comment. When the
pull request touches none of them, it posts nothing.

```markdown
**COMPLEX.md**: 1 hotspot touched, 2 co-change partners not in this pull request.

| Hotspot | Score | Churn | Fixes | Fan in | Tests |
|---|--:|--:|--:|--:|--:|
| `cli/src/targets.js` | 1960 | 17 | 4 | 2 | 2 |

- `cli/src/targets.js`: Before editing this file, run `cd cli && node --test test/invocation.test.js test/truth.test.js test/channels.test.js`.

**Co-change partners not in this pull request**

- `cli/src/targets.js` changed. Unchanged: `cli/bin/complex-md.js` (7 commits together, 44 percent). Say whether each needs a change.
- `README.md` changed. Unchanged: `bench/RESULTS.md` (4 commits together, 80 percent). Say whether each needs a change.
```

That comment comes from the complex-md repository's own map. Every later
push edits the same comment. A push that drops the last hot file clears it.

## Setup

1. Commit a COMPLEX.md at the repository root: `npx complex-md`.
2. Copy [examples/complex-md-comment.yml](examples/complex-md-comment.yml)
   to `.github/workflows/`.
3. Pin the action to the full commit SHA of a release:

```sh
git ls-remote https://github.com/KletoWorks/complex-md-action refs/tags/v0.1.0
```

```yaml
- uses: KletoWorks/complex-md-action@<the 40 character SHA> # v0.1.0
```

A tag can move to other code; a commit SHA cannot. The comment job has no
npm dependencies, so the SHA pins every line it runs. The bounds job adds
one download, pinned by its sha512.

## Why pull_request_target is safe here

A comment on a pull request from a fork needs a write token, and only
`pull_request_target` has one. That trigger is dangerous when a job checks
out the pull request and runs its code with that token. This action never
does:

- It reads COMPLEX.md at the base commit through the contents API. No file
  from the pull request is on disk.
- It reads the pull request's file list through the API and compares names
  with the map. It prints only paths that the base map names.
- It runs no shell and checks out nothing. The example job has no
  `actions/checkout` step and no `run` step; this repository's tests keep
  it that way.
- It asks for `contents: read` and `pull-requests: write`, nothing more.

One run makes three or four REST reads, more for a long file list, and one
write at most. This follows
the GitHub Security Lab guidance on
[preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).

## Bounds: fail the pull request that reaches too far

A team declares how far one change may reach in `.complex-md/bounds.json`:

```json
{ "reach": 25, "untested_reach": 5, "hot_reach": 3 }
```

[examples/complex-md-bounds.yml](examples/complex-md-bounds.yml) runs
`complex-md impact --strict` on each changed file and fails the job when a
file is over a bound. Each failure is a file annotation that names the
bound and the margin. On the complex-md repository, on a 4 CPU machine,
three files took 3.1 s, including the CLI download.

- It runs on `pull_request` with a read only token, because it reads the
  pull request's files. The action refuses it under `pull_request_target`.
- The bounds come from the base branch. A pull request cannot loosen its own
  check; its new bounds apply after merge.
- The CLI is complex-md 0.9.2, checked against the sha512 integrity that npm
  published for it. It runs with no token in its env.
- `verify: true` runs `complex-md verify`, the map drift check, once the
  pinned CLI has that command. With 0.9.2 it warns and checks nothing.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `comment` | `true` | Post or edit the comment. |
| `map-path` | `COMPLEX.md` | Path of the map on the base branch. |
| `impact-strict` | `false` | Run `impact --strict` on changed files. `pull_request` only. |
| `impact-max-files` | `25` | Most files `impact-strict` checks in one run. |
| `verify` | `false` | Run `complex-md verify`. `pull_request` only. |
| `github-token` | `github.token` | Token for the REST API. |

Outputs: `hotspots`, `load-bearing` and `partners` (counts), `comment`
(`created`, `updated`, `unchanged`, `cleared`, `none` or `forbidden`) and
`comment-url`.

## What it does not do

It does not generate or refresh COMPLEX.md; the map lags by as many commits
as the footer says. GitHub lists 3,000 files of a pull request at most, and
the comment says so when a pull request has more.

## Development

```sh
npm test
```

The tests use fixture maps and file lists and a fake GitHub API. The parser
in `src/vendor/complexmd.js` is a copy of the CLI's, with its source commit
in the header.

## License

MIT. James L. Cowan Jr.
