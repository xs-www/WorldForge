import test from 'node:test';
import assert from 'node:assert/strict';
import { composeImagePrompt, imagePromptKey, selectVisualLore } from '../image-context.mjs';
import { normalizePromptSettings } from '../prompt-settings.mjs';

const library=[
  {id:'CHR-W01-001',type:'character',name:'检定官',status:'proposed',summary:'穿耐热检定服，携带黄铜量具。',details:'长期驻守蓄魔阶梯城。',relationIds:['FAC-W01-001']},
  {id:'FAC-W01-001',type:'faction',name:'检定院',status:'canon',summary:'负责设备安全检定。',relationIds:[]},
  {id:'STORY-W01-001',type:'story',name:'夜班',status:'proposed',details:'检定官在潮湿巷道中检查失稳回路。',relationIds:['CHR-W01-001']}
];

test('card image context follows lore refs, direct relations and attached stories',()=>{
  const payload={targetType:'card',card:{name:'检定官',loreRefs:['CHR-W01-001']},library};
  assert.deepEqual(selectVisualLore(payload).map(entry=>entry.id),['CHR-W01-001','FAC-W01-001','STORY-W01-001']);
  const result=composeImagePrompt(payload,normalizePromptSettings());
  assert.equal(imagePromptKey(payload),'card');
  assert.match(result.prompt,/耐热检定服/);
  assert.match(result.prompt,/潮湿巷道/);
  assert.match(result.prompt,/统一视觉方向/);
});

test('lore visual prototypes use the matching image prompt category',()=>{
  const target=library[0],result=composeImagePrompt({targetType:'lore',targetId:target.id,target,purpose:'portrait',library},normalizePromptSettings());
  assert.equal(result.key,'character');
  assert.match(result.prompt,/人物视觉原型/);
  assert.deepEqual(result.contextIds,['CHR-W01-001','FAC-W01-001','STORY-W01-001']);
});
