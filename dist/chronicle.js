(function (root) {
  const normalize = (value = {}, enabled = true) => {
    if (!enabled) return { kind: '', parentId: '', dateLabel: '', order: null };
    const kind = value?.kind === 'entry' ? 'entry' : 'chronicle';
    const rawOrder = value?.order;
    const order = rawOrder === '' || rawOrder === null || rawOrder === undefined || !Number.isFinite(Number(rawOrder)) ? null : Number(rawOrder);
    return {
      kind,
      parentId: kind === 'entry' ? String(value?.parentId || '').trim() : '',
      dateLabel: kind === 'entry' ? String(value?.dateLabel || '').trim() : '',
      order: kind === 'entry' ? order : null
    };
  };

  // `types` 是当前资料库里被作者设为「编年史」表单的资料组集合；缺省时退回旧的单一
  // timeline 类型，保证既有测试与旧调用不需要改签名。
  const canParent = (parent, child, worldId, types) => Boolean(
    child?.chronicle?.kind === 'entry' &&
    parent &&
    (types ? types.has(parent.type) : parent.type === 'timeline') &&
    parent.worldId === worldId &&
    parent.chronicle?.kind === 'chronicle'
  );

  const sortEntries = entries => [...entries].sort((a, b) => {
    const aOrder = a.chronicle?.order;
    const bOrder = b.chronicle?.order;
    if (aOrder !== null && aOrder !== undefined && bOrder !== null && bOrder !== undefined && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder !== null && aOrder !== undefined) return -1;
    if (bOrder !== null && bOrder !== undefined) return 1;
    return String(a.chronicle?.dateLabel || a.name).localeCompare(String(b.chronicle?.dateLabel || b.name), 'zh-CN');
  });

  function build(entries, query = '', types = null) {
    const timelines = entries.filter(entry => types ? types.has(entry.type) : entry.type === 'timeline');
    const byId = new Map(timelines.map(entry => [entry.id, entry]));
    const roots = [];
    const orphans = [];
    const children = new Map();
    timelines.forEach(entry => {
      if (entry.chronicle?.kind !== 'entry') return roots.push(entry);
      const parent = byId.get(entry.chronicle.parentId);
      if (!canParent(parent, entry, entry.worldId, types)) return orphans.push(entry);
      if (!children.has(parent.id)) children.set(parent.id, []);
      children.get(parent.id).push(entry);
    });
    children.forEach((value, key) => children.set(key, sortEntries(value)));
    const needle = query.trim().toLowerCase();
    const visibleIds = new Set();
    if (needle) timelines.forEach(entry => {
      const haystack = `${entry.name} ${entry.id} ${entry.chronicle?.dateLabel || ''} ${entry.summary || ''} ${entry.details || ''} ${(entry.tags || []).join(' ')}`.toLowerCase();
      if (!haystack.includes(needle)) return;
      visibleIds.add(entry.id);
      if (entry.chronicle?.parentId) visibleIds.add(entry.chronicle.parentId);
    });
    return { roots: sortEntries(roots), orphans: sortEntries(orphans), children, visibleIds, hasQuery: Boolean(needle) };
  }

  root.WorldforgeChronicle = { normalize, canParent, sortEntries, build };
})(typeof window === 'undefined' ? globalThis : window);
