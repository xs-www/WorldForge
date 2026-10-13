(function (root) {
  const kinds = {
    continent: { label: '大陆', rank: 0 },
    country: { label: '国家', rank: 1 },
    region: { label: '地区', rank: 2 },
    area: { label: '区域', rank: 3 },
    city: { label: '城市', rank: 4 },
    site: { label: '地点', rank: 5 },
    route: { label: '路线 / 通道', rank: 5 }
  };
  const parentKinds = {
    continent: [],
    country: ['continent'],
    region: ['country'],
    area: ['country', 'region'],
    city: ['country', 'region', 'area'],
    site: ['country', 'region', 'area', 'city'],
    route: ['country', 'region', 'area', 'city']
  };
  const nextKinds = { continent: 'country', country: 'region', region: 'area', area: 'city', city: 'site' };
  const normalizeKind = kind => kinds[kind] ? kind : kind === 'place' ? 'site' : 'region';
  const allowedParentKinds = kind => parentKinds[normalizeKind(kind)] || [];
  const canParent = (parent, childKind, worldId) => Boolean(parent && parent.type === 'location' && parent.worldId === worldId && allowedParentKinds(childKind).includes(normalizeKind(parent.location?.kind)));
  const sortEntries = entries => [...entries].sort((a, b) => {
    const rank = kinds[normalizeKind(a.location?.kind)].rank - kinds[normalizeKind(b.location?.kind)].rank;
    return rank || String(a.name).localeCompare(String(b.name), 'zh-CN');
  });
  function buildTree(entries, query = '') {
    const locations = entries.filter(entry => entry.type === 'location');
    const byId = new Map(locations.map(entry => [entry.id, entry]));
    const children = new Map();
    const roots = [];
    const orphans = [];
    locations.forEach(entry => {
      const kind = normalizeKind(entry.location?.kind);
      const parentId = String(entry.location?.parentId || '');
      if (kind === 'continent' && !parentId) return roots.push(entry);
      const parent = byId.get(parentId);
      if (!canParent(parent, kind, entry.worldId)) return orphans.push(entry);
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(entry);
    });
    children.forEach((value, key) => children.set(key, sortEntries(value)));
    const needle = query.trim().toLowerCase();
    const visibleIds = new Set();
    if (needle) locations.forEach(entry => {
      const haystack = `${entry.name} ${entry.id} ${entry.summary || ''} ${entry.details || ''} ${(entry.tags || []).join(' ')}`.toLowerCase();
      if (!haystack.includes(needle)) return;
      let current = entry;
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        visibleIds.add(current.id);
        current = byId.get(current.location?.parentId);
      }
    });
    return { roots: sortEntries(roots), orphans: sortEntries(orphans), children, visibleIds, hasQuery: Boolean(needle) };
  }
  root.WorldforgeGeography = { kinds, parentKinds, nextKinds, normalizeKind, allowedParentKinds, canParent, buildTree };
})(typeof window === 'undefined' ? globalThis : window);
