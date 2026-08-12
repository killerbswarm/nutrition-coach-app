/** Normalize for comparison */
export function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Find a client for a payment/roster name.
 * Match order: exact name → alias → soft "contains" (longer canonical wins later)
 */
export function resolveClient(rawName, clients = []) {
  const q = normName(rawName);
  if (!q || !clients.length) return null;

  // 1) Exact canonical name
  let hit = clients.find((c) => normName(c.name) === q);
  if (hit) return hit;

  // 2) Alias list
  hit = clients.find((c) =>
    (c.nameAliases || []).some((a) => normName(a) === q)
  );
  if (hit) return hit;

  // 3) Soft: one contains the other (Abi vs Abriel)
  hit = clients.find((c) => {
    const n = normName(c.name);
    if (!n) return false;
    if (n.includes(q) || q.includes(n)) return true;
    return (c.nameAliases || []).some((a) => {
      const an = normName(a);
      return an && (an.includes(q) || q.includes(an));
    });
  });
  return hit || null;
}

/** Canonical display name for any string */
export function displayClientName(rawName, clients = []) {
  const c = resolveClient(rawName, clients);
  return c?.name || String(rawName || '').trim() || 'Unknown';
}