// A fake fetch for the GitHub REST API. Routes map "METHOD /path" to a
// handler that returns { status, body, headers }. Every call is recorded.
export function fakeGitHub(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const key = `${method} ${u.pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers });
    const handler = routes[key];
    const res = handler ? await handler({ query: Object.fromEntries(u.searchParams), body, url: u }) : { status: 404, body: { message: 'Not Found' } };
    const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? null);
    return new Response(res.status === 204 ? null : text, { status: res.status || 200, headers: res.headers || {} });
  };
  return { fetch, calls };
}
