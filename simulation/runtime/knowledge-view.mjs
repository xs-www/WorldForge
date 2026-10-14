export function compileKnowledgeView(records, subjectId, atTick) {
  return records
    .filter(record => record.subjectId === subjectId)
    .filter(record => record.observedAtTick <= atTick)
    .filter(record => record.expiresAtTick == null || record.expiresAtTick > atTick)
    .sort((left, right) => left.observedAtTick - right.observedAtTick || left.knowledgeId.localeCompare(right.knowledgeId))
    .map(record => structuredClone(record));
}

export function knowledgeRecipients(action, state, { broadcast = false } = {}) {
  const recipients = new Set([action.actorId]);
  if (action.type === 'energy.transfer' && typeof action.parameters?.targetId === 'string') recipients.add(action.parameters.targetId);
  if (broadcast) {
    for (const entity of state.entities) recipients.add(entity.entityId);
  }
  return [...recipients].sort();
}
