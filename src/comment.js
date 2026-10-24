// The sticky comment. One comment per pull request, found again by its
// first line. Every path it prints comes from the base branch map; a path
// that only the pull request names is never printed.

export const MARKER = '<!-- complex-md-action:sticky -->';
export const PARTNERS_SHOWN = 3;
export const PARTNER_GROUPS_SHOWN = 20;
/* GitHub rejects a comment body over 65,536 characters. */
export const MAX_BODY = 60000;

/* A path as a Markdown code span. Control characters and line breaks
   become spaces, a pipe is escaped so it cannot end a table cell, and a
   backtick in the path gets a longer fence. */
export function code(s) {
  const clean = String(s).replace(/[\u0000-\u001f\u007f]+/g, (m) => (/[\n\r\t]/.test(m) ? ' ' : '')).replace(/\|/g, '\\|');
  if (!clean.includes('`')) return '`' + clean + '`';
  return '`` ' + clean + ' ``';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const short = (sha) => (sha ? String(sha).slice(0, 7) : 'unknown');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

function footer({ baseSha, mapPath = 'COMPLEX.md', front = {}, behind, truncated }) {
  const out = [];
  if (truncated) {
    out.push(`GitHub lists the first ${truncated} files of a pull request. Files after that were not checked.`, '');
  }
  let made = '';
  if (front.generated || front.commit) {
    made = ` The map was generated${front.generated ? ` ${front.generated}` : ''}`;
    if (front.commit) {
      made += ` at ${code(short(front.commit))}`;
      if (behind === null || behind === undefined) made += ', a commit not in the base history';
      else if (behind === 0) made += ', current with the base';
      else made += `, ${plural(behind, 'commit', 'commits')} behind the base`;
    }
    made += '.';
  }
  out.push(`<sub>Read from ${code(mapPath)} at base ${code(short(baseSha))}.${made} complex-md-action runs no code from this pull request.</sub>`);
  return out.join('\n');
}

export function renderComment(f, ctx = {}) {
  const counts = [];
  if (f.hotspots.length) counts.push(`${plural(f.hotspots.length, 'hotspot', 'hotspots')} touched`);
  if (f.loadBearing.length) counts.push(`${plural(f.loadBearing.length, 'load bearing file', 'load bearing files')} touched`);
  if (f.partners.length) counts.push(`${plural(f.partners.length, 'co-change partner', 'co-change partners')} not in this pull request`);
  const out = [MARKER, `**COMPLEX.md**: ${counts.join(', ')}.`, ''];

  if (f.hotspots.length) {
    out.push('| Hotspot | Score | Churn | Fixes | Fan in | Tests |', '|---|--:|--:|--:|--:|--:|');
    for (const h of f.hotspots) {
      const r = h.row;
      out.push(`| ${code(h.path)} | ${r.score ?? ''} | ${r.churn ?? ''} | ${r.fixes ?? ''} | ${r.fan_in ?? ''} | ${r.tests ?? ''} |`);
    }
    out.push('');
  }
  if (f.loadBearing.length) {
    out.push('| Load bearing | Fan in | Tests |', '|---|--:|--:|');
    for (const h of f.loadBearing) out.push(`| ${code(h.path)} | ${h.row.fan_in ?? ''} | ${h.row.tests ?? ''} |`);
    out.push('');
  }
  const directives = [...f.hotspots, ...f.loadBearing].filter((h) => h.directive);
  for (const h of directives) out.push(`- ${code(h.path)}: ${oneLine(h.directive)}`);
  if (directives.length) out.push('');

  if (f.partners.length) {
    out.push('**Co-change partners not in this pull request**', '');
    const groups = new Map();
    for (const p of f.partners) {
      if (!groups.has(p.changed)) groups.set(p.changed, []);
      groups.get(p.changed).push(p);
    }
    const shownGroups = [...groups].slice(0, PARTNER_GROUPS_SHOWN);
    for (const [changed, list] of shownGroups) {
      const shown = list.slice(0, PARTNERS_SHOWN).map((p) => `${code(p.partner)} (${p.count} commits together${p.coupling === null ? '' : `, ${p.coupling} percent`})`);
      const more = list.length > PARTNERS_SHOWN ? `, and ${list.length - PARTNERS_SHOWN} more in COMPLEX.md` : '';
      out.push(`- ${code(changed)} changed. Unchanged: ${shown.join(', ')}${more}. Say whether each needs a change.`);
    }
    if (groups.size > shownGroups.length) {
      out.push(`- and ${groups.size - shownGroups.length} more changed files with a partner left unchanged.`);
    }
    out.push('');
  }
  out.push(footer(ctx));
  let body = out.join('\n');
  if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY - 40) + '\n\n(comment cut at the size limit)';
  return body;
}

export function renderCleared(ctx = {}) {
  return [MARKER, '**COMPLEX.md**: this pull request no longer touches a hotspot, a load bearing file or a co-change pair.', '', footer(ctx)].join('\n');
}
