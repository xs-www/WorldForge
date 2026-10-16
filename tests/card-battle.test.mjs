import test from 'node:test';
import assert from 'node:assert/strict';
await import('../dist/battle.js');
const battle=globalThis.WorldforgeBattle;

function minion(overrides={}){
  const card=battle.normalizeCard({id:'TEST',name:'测试随从',type:'minion',cost:1,attack:2,health:2,...overrides});
  return{...card,instanceId:overrides.instanceId||`unit-${Math.random()}`,maxHealth:card.health,summonedTurn:0,attacked:false,shield:battle.KEYWORDS.isolate.id===card.keywordUsages?.[0]?.keywordId};
}

test('game creation and shuffle are deterministic for the same seed',()=>{
  const first=battle.createGame({seed:'same-seed'}),second=battle.createGame({seed:'same-seed'});
  assert.deepEqual(first,second);
  assert.equal(first.players.player.health,20);
  assert.equal(first.players.player.hand.length,3);
  assert.equal(first.players.player.mana,1);
});

test('playing a minion spends mana and ordinary minions cannot attack on entry',()=>{
  const state=battle.createGame();
  state.players.player.mana=3;
  state.players.player.hand=[battle.normalizeCard({id:'M',name:'普通机兵',type:'minion',cost:2,attack:2,health:3})];
  battle.playCard(state,'player',0);
  assert.equal(state.players.player.mana,1);
  assert.equal(state.players.player.board.length,1);
  assert.equal(battle.canAttack(state,'player',state.players.player.board[0]),false);
});

test('疾启 grants entry-turn attack permission',()=>{
  const state=battle.createGame();
  state.players.player.mana=2;
  state.players.player.hand=[battle.normalizeCard({id:'S',name:'疾启单位',type:'minion',cost:2,attack:2,health:1,keywordUsages:[{keywordId:battle.KEYWORDS.surge.id}]})];
  battle.playCard(state,'player',0);
  assert.equal(battle.canAttack(state,'player',state.players.player.board[0]),true);
});

test('护持 replaces the ordinary attack target list',()=>{
  const state=battle.createGame(),attacker=minion({instanceId:'attacker'}),guard=minion({instanceId:'guard',keywordUsages:[{keywordId:battle.KEYWORDS.guard.id}]}),other=minion({instanceId:'other'});
  state.players.player.board=[attacker];state.players.opponent.board=[guard,other];
  assert.deepEqual(battle.legalAttackTargets(state,'player','attacker').map(item=>item.id),['guard']);
  assert.throws(()=>battle.attack(state,'player','attacker','opponent-hero'),/不合法/);
});

test('隔绝 replaces only the first damage event',()=>{
  const state=battle.createGame(),first=minion({instanceId:'a1'}),second=minion({instanceId:'a2'}),shielded=minion({instanceId:'shield',health:3,keywordUsages:[{keywordId:battle.KEYWORDS.isolate.id}]});
  state.players.player.board=[first,second];state.players.opponent.board=[shielded];
  battle.attack(state,'player','a1','shield');
  assert.equal(shielded.health,3);assert.equal(shielded.shield,false);
  battle.attack(state,'player','a2','shield');
  assert.equal(state.players.opponent.board.length,1);assert.equal(shielded.health,1);
});

test('余响 resolves a validated effect after destruction',()=>{
  const state=battle.createGame(),attacker=minion({instanceId:'attacker',attack:1}),echo=minion({instanceId:'echo',attack:0,health:1,keywordUsages:[{keywordId:battle.KEYWORDS.echo.id,params:{effect:{operation:'deal_damage',target:'enemy_hero',amount:1}}}]});
  state.players.player.board=[attacker];state.players.opponent.board=[echo];
  battle.attack(state,'player','attacker','echo');
  assert.equal(state.players.opponent.board.length,0);
  assert.equal(state.players.player.health,19);
});

test('rule opponent plays a bounded turn and returns control',()=>{
  const state=battle.createGame({seed:'ai-cycle'});
  battle.endTurn(state,'player');
  battle.runRuleOpponent(state);
  assert.equal(state.currentPlayer,'player');
  assert.equal(state.status,'playing');
  assert.ok(state.turn>=3);
});

test('unknown keyword ids and arbitrary effects do not become executable',()=>{
  const card=battle.normalizeCard({keywordUsages:[{keywordId:'KEY-UNKNOWN'}],effect:{operation:'run_javascript',target:'enemy_hero',amount:99}});
  assert.deepEqual(card.keywordUsages,[]);
  assert.equal(card.effect,null);
});
