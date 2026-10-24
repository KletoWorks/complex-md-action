// Action inputs. GitHub passes each one as INPUT_<NAME> with the name in
// upper case and spaces as underscores; a hyphen stays a hyphen.

export function input(env, name, fallback = '') {
  const v = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

export function boolInput(env, name, fallback) {
  const v = input(env, name, String(fallback)).toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`input ${name} must be true or false, got: ${JSON.stringify(v)}`);
}

export function intInput(env, name, fallback, min = 1) {
  const raw = input(env, name, String(fallback));
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`input ${name} must be a whole number of ${min} or more, got: ${JSON.stringify(raw)}`);
  return n;
}
