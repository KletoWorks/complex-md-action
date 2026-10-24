---
complex_md: "0.3"
generated: 2026-10-20
commit: 1234567
tool: complex-md/0.9.2
window_commits: 300
files_analyzed: 120
hotspots:
  - path: lib/server.js
    kind: source
    loc: 812
    churn: 41
    churn_w: 18.2
    fixes: 17
    authors: 9
    owner_share: 0.41
    fan_in: 23
    tests: 6
    score: 9120
  - path: lib/route.js
    kind: source
    loc: 540
    churn: 30
    churn_w: 11.0
    fixes: 9
    authors: 7
    owner_share: 0.52
    fan_in: 12
    tests: 4
    score: 5410
load_bearing:
  - path: lib/symbols.js
    kind: source
    loc: 60
    fan_in: 31
    tests: 2
co_change:
  - files: [lib/server.js, types/server.d.ts]
    count: 14
    coupling: 61
  - files: [lib/route.js, test/route.test.js]
    count: 11
    coupling: 48
  - files: [lib/errors.js, docs/errors.md]
    count: 9
    coupling: 75
  - files: [lib/server.js, lib/route.js]
    count: 8
    coupling: 35
  - files: [lib/server.js, docs/server.md]
    count: 6
    coupling: 30
  - files: [lib/server.js, lib/hooks.js]
    count: 5
    coupling: 28
blind_spots:
  - "1 file over 1 MB not read for dependencies"
---

## Where the risk lives

Risk concentrates in lib/server.js and lib/route.js.

## Why these files are hot

lib/server.js owns the request lifecycle. 17 of its 41 commits were fixes. Before editing this file, run `npm run test:server` and keep types/server.d.ts in step.

lib/route.js registers routes and their hooks. 9 of its 30 commits were fixes. Before editing this file, run `npm run test:route`.

## Change coupling

lib/errors.js and docs/errors.md move together at 75 percent.

## What to read first

1. lib/server.js
