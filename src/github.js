// A small GitHub REST client over the fetch that Node ships, and the four
// calls the action makes. No SDK, so no dependency to pin or audit.
import { MARKER } from './comment.js';

const API_VERSION = '2022-11-28';
const MAX_PAGES = 30;

export function client({ token, apiUrl = 'https://api.github.com', fetch = globalThis.fetch, userAgent = 'complex-md-action' } = {}) {
  const base = new URL(apiUrl.replace(/\/+$/, '') + '/');
  async function request(method, path, { body, accept = 'application/vnd.github+json', query, url } = {}) {
    const u = url ? new URL(url) : new URL(path.replace(/^\/+/, ''), base);
    if (u.host !== base.host) throw new Error(`refusing a request to another host: ${u.host}`);
    for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, String(v));
    const headers = { accept, 'x-github-api-version': API_VERSION, 'user-agent': userAgent };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(u.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    if (accept.includes('json') && !accept.includes('raw')) {
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    }
    return { status: res.status, ok: res.ok, text, json, headers: res.headers };
  }
  async function paginate(path, query = {}) {
    const items = [];
    let next = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = next ? await request('GET', null, { url: next }) : await request('GET', path, { query: { per_page: 100, ...query } });
      if (!r.ok) throw httpError('GET', path, r);
      if (Array.isArray(r.json)) items.push(...r.json);
      next = nextLink(r.headers.get('link'));
      if (!next) break;
    }
    return items;
  }
  return { request, paginate };
}

function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return null;
}

function httpError(method, path, r) {
  const msg = r.json?.message || r.text?.slice(0, 200) || '';
  const e = new Error(`GitHub API ${method} ${path} returned ${r.status}${msg ? `: ${msg}` : ''}`);
  e.status = r.status;
  return e;
}

/* A repository relative path for the contents API. The input comes from
   the workflow file, but a path that climbs out of the repository or
   starts at the root is a mistake worth stopping on. */
export function contentsPath(p) {
  const parts = String(p || '').split('/');
  if (!p || p.startsWith('/') || parts.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`map-path must be a relative path inside the repository, got: ${JSON.stringify(p)}`);
  }
  return parts.map(encodeURIComponent).join('/');
}

/* The map as text at one commit of the base repository, or null. */
export async function readMap(gh, repo, path, ref) {
  const p = `/repos/${repo}/contents/${contentsPath(path)}`;
  const r = await gh.request('GET', p, { accept: 'application/vnd.github.raw+json', query: { ref } });
  if (r.status === 404) return null;
  if (!r.ok) throw httpError('GET', p, r);
  return r.text;
}

/* The pull request's file list. GitHub returns 3,000 files at most. */
export async function listFiles(gh, repo, number) {
  return gh.paginate(`/repos/${repo}/pulls/${number}/files`);
}

/* How many base commits came after the map's commit: 0 when they are the
   same, null when the map commit is unknown or not an ancestor. */
export async function commitsBehind(gh, repo, mapCommit, baseSha) {
  if (!/^[0-9a-f]{4,40}$/i.test(String(mapCommit || '')) || !/^[0-9a-f]{4,40}$/i.test(String(baseSha || ''))) return null;
  const r = await gh.request('GET', `/repos/${repo}/compare/${mapCommit}...${baseSha}`);
  if (!r.ok || !r.json) return null;
  if (r.json.status === 'identical') return 0;
  if (r.json.status === 'ahead' && Number.isInteger(r.json.ahead_by)) return r.json.ahead_by;
  return null;
}

/* Only a bot comment that opens with the marker counts. A person who
   pastes the marker into their own comment does not take over the slot. */
export async function findSticky(gh, repo, number) {
  const list = await gh.paginate(`/repos/${repo}/issues/${number}/comments`);
  return list.find((c) => c?.user?.type === 'Bot' && typeof c.body === 'string' && c.body.startsWith(MARKER + '\n')) || null;
}

/* Create, edit, clear or leave the one comment. body null means the pull
   request touches nothing: post nothing, or clear a comment from an
   earlier push so it does not describe files the pull request dropped. */
export async function syncSticky(gh, repo, number, { body, cleared }) {
  const existing = await findSticky(gh, repo, number);
  const want = body ?? (existing ? cleared : null);
  if (want === null) return { action: 'none', url: null };
  if (existing && existing.body === want) return { action: 'unchanged', url: existing.html_url ?? null };
  if (existing) {
    const p = `/repos/${repo}/issues/comments/${existing.id}`;
    const r = await gh.request('PATCH', p, { body: { body: want } });
    if (!r.ok) throw httpError('PATCH', p, r);
    return { action: body === null ? 'cleared' : 'updated', url: r.json?.html_url ?? existing.html_url ?? null };
  }
  const p = `/repos/${repo}/issues/${number}/comments`;
  const r = await gh.request('POST', p, { body: { body: want } });
  if (!r.ok) throw httpError('POST', p, r);
  return { action: 'created', url: r.json?.html_url ?? null };
}
