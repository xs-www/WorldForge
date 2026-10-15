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

test('card flavor text and artwork crop normalize safely',()=>{
  const card=cards.normalize({flavorText:'炉火边流传的一句话。',artCrop:{x:120,y:-4,zoom:9}});
  assert.equal(card.flavorText,'炉火边流传的一句话。');
  assert.deepEqual(card.artCrop,{x:100,y:0,zoom:2.5});
  assert.deepEqual(cards.normalize({}).artCrop,{x:50,y:50,zoom:1});
});

test('card stats follow minion, spell, and weapon semantics',()=>{
  const minion=cards.normalize({type:'minion',attack:3,health:4});
  assert.equal(minion.attack,3);assert.equal(minion.health,4);assert.equal(minion.durability,null);
  const spell=cards.normalize({type:'spell',attack:9,health:9});
  assert.equal(spell.attack,null);assert.equal(spell.health,null);assert.equal(spell.durability,null);
  const weapon=cards.normalize({type:'equipment',attack:2,durability:3});
  assert.equal(weapon.attack,2);assert.equal(weapon.health,null);assert.equal(weapon.durability,3);
});

test('compiled description groups standalone, detailed, then ordinary rules',()=>{
  const keywords=new Map([['A',{name:'战吼'}],['B',{name:'过载'}],['C',{name:'护盾'}]]);
  const compiled=cards.compileDescription({keywordUsages:[{keywordId:'B',detail:'下回合少1点资源'},{keywordId:'A',detail:''},{keywordId:'C',detail:''}],rulesText:'抽一张牌。'},keywords);
  assert.deepEqual(compiled.lines,['战吼','护盾','过载：下回合少1点资源','抽一张牌。']);
  assert.equal(compiled.text,'战吼，护盾，过载：下回合少1点资源\n抽一张牌。');
  assert.deepEqual(compiled.runs.filter(run=>run.bold).map(run=>run.text),['战吼','护盾','过载：']);
});

test('limited rich text compiles HTML and Markdown markers into safe style runs',()=>{
  const runs=cards.parseRichText('<b>粗体</b>与<i>斜体</i>、**再粗**、*再斜*、<script>原样文本</script>');
  assert.equal(runs.map(run=>run.text).join(''),'粗体与斜体、再粗、再斜、<script>原样文本</script>');
  assert.equal(runs.find(run=>run.text==='粗体').bold,true);
  assert.equal(runs.find(run=>run.text==='斜体').italic,true);
  assert.equal(runs.find(run=>run.text==='再粗').bold,true);
  assert.equal(runs.find(run=>run.text==='再斜').italic,true);
  const compiled=cards.compileDescription({keywordUsages:[{keywordId:'A',detail:'造成 <i>2点</i> 伤害'}],rulesText:'获得 **护甲**。'},new Map([['A',{name:'点燃'}]]));
  assert.equal(compiled.text,'点燃：造成 2点 伤害\n获得 护甲。');
  assert.equal(compiled.runs.some(run=>run.kind==='detail'&&run.text==='2点'&&run.italic),true);
  assert.equal(compiled.runs.some(run=>run.kind==='rules'&&run.text==='护甲'&&run.bold),true);
});

test('entity-like lore entries receive deterministic draft card types',()=>{
  assert.equal(cards.defaultTypeForLore({type:'character'}),'minion');
  assert.equal(cards.defaultTypeForLore({type:'item'}),'equipment');
  assert.equal(cards.defaultTypeForLore({type:'magic'}),'spell');
  assert.equal(cards.isCardableLore({id:'STORY-W01-001',type:'story'}),false);
  assert.equal(cards.isCardableLore({id:'CHR-W01-001',type:'character'}),true);
});
