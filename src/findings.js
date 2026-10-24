// Which files in a pull request the map warns about. The input is the
// parsed COMPLEX.md from the base branch and the file list from the
// GitHub API. Nothing here reads the pull request's code.

/* Every path the diff touches. A rename touches both its old and its new
   path, because the map knows the file by its old name. A deleted file
   counts as touched: its partners may still need a change. */
export function touchedPaths(files) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (typeof p === 'string' && p && !seen.has(p)) { seen.add(p); out.push(p); }
  };
  for (const f of files || []) {
    if (!f || typeof f !== 'object') continue;
    add(f.filename);
    add(f.previous_filename);
  }
  return out;
}

/* The findings for one diff.
   hotspots and loadBearing keep the map's order, which is rank order.
   partners holds each co-change pair with exactly one side touched,
   strongest pair first. */
export function findTouched(map, files) {
  const touched = new Set(touchedPaths(files));
  const pick = (rows) => rows
    .filter((r) => touched.has(r.path))
    .map((r) => ({ path: r.path, row: r, directive: map.directive(r.path) }));
  const hotspots = pick(map.hotspots || []);
  const loadBearing = pick(map.load_bearing || []);
  const partners = [];
  for (const pair of map.co_change || []) {
    const [a, b] = pair.files || [];
    if (typeof a !== 'string' || typeof b !== 'string') continue;
    const hasA = touched.has(a);
    const hasB = touched.has(b);
    if (hasA === hasB) continue;
    partners.push({
      changed: hasA ? a : b,
      partner: hasA ? b : a,
      count: Number(pair.count) || 0,
      coupling: Number.isFinite(Number(pair.coupling)) ? Number(pair.coupling) : null,
    });
  }
  partners.sort((x, y) => y.count - x.count);
  return {
    touched: [...touched],
    hotspots,
    loadBearing,
    partners,
    clean: hotspots.length === 0 && loadBearing.length === 0 && partners.length === 0,
  };
}
