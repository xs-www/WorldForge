import test from 'node:test';
import assert from 'node:assert/strict';
await import('../dist/cards.js');
const cards=globalThis.WorldforgeCards;

test('legacy card types migrate into the three current card types',()=>{
  assert.equal(cards.normalize({type:'unit'}).type,'minion');
  assert.equal(cards.normalize({type:'action'}).type,'spell');
  assert.equal(cards.normalize({type:'asset'}).type,'equipment');
});

test('card rarity and lore refs normalize safely',()=>{
  const card=cards.normalize({rarity:'epic',loreRefs:['CHR-W01-001','CHR-W01-001','']});
  assert.equal(card.rarity,'epic');
  assert.deepEqual(card.loreRefs,['CHR-W01-001']);
  assert.equal(cards.normalize({rarity:'unknown'}).rarity,'common');
});

test('card reference images persist as a deduplicated bounded series',()=>{
  const ids=Array.from({length:12},(_,index)=>`ART-${index}`);
  const card=cards.normalize({referenceAssetIds:[ids[0],ids[0],...ids.slice(1)]});
  assert.equal(card.referenceAssetIds.length,10);
  assert.equal(card.referenceAssetIds[0],'ART-0');
});

test('entity-like lore entries receive deterministic draft card types',()=>{
  assert.equal(cards.defaultTypeForLore({type:'character'}),'minion');
  assert.equal(cards.defaultTypeForLore({type:'item'}),'equipment');
  assert.equal(cards.defaultTypeForLore({type:'magic'}),'spell');
  assert.equal(cards.isCardableLore({id:'STORY-W01-001',type:'story'}),false);
  assert.equal(cards.isCardableLore({id:'CHR-W01-001',type:'character'}),true);
});
