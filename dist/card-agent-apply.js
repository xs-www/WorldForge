// 卡牌 Agent 补丁回填的纯逻辑：浏览器与测试共用同一实现，避免两处判断漂移。
// 先按 patch.type 解析目标类型，再决定 health / durability 写到编辑器的哪个输入。
window.WorldforgeCardAgentApply = (function () {
  const SELECTORS = { name: 'cardName', cost: 'cardCost', attack: 'cardAttack', rulesText: 'cardRules', rarity: 'cardRarity', type: 'cardType' };
  function resolveTargetType(patch, currentType) {
    return (patch && patch.type) || currentType;
  }
  /** 返回 { targetType, values }；values 的键是编辑器元素 id。 */
  function formAssignments(patch, currentType) {
    const targetType = resolveTargetType(patch, currentType), values = {};
    for (const [field, value] of Object.entries(patch || {})) {
      if (field === 'health') { if (targetType === 'minion') values.cardHealth = value; continue; }
      if (field === 'durability') { if (targetType === 'equipment') values.cardHealth = value; continue; }
      if (field === 'keywordIds' || field === 'notes' || field === 'effects' || field === 'loreRefs') continue;
      const selector = SELECTORS[field];
      if (selector) values[selector] = value;
    }
    return { targetType, values };
  }
  return { resolveTargetType, formAssignments };
})();
