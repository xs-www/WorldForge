import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReferenceAssetIds, parseReferenceUpload, toReferenceDataUrl } from '../reference-assets.mjs';

test('reference uploads validate target, type and local size boundary',()=>{
  const uploaded=parseReferenceUpload({targetType:'card',targetId:'CARD-W01-DRAFT-1',fileName:'hero.png',dataUrl:'data:image/png;base64,aGVsbG8='});
  assert.equal(uploaded.bytes.toString(),'hello');
  assert.equal(uploaded.mimeType,'image/png');
  assert.throws(()=>parseReferenceUpload({targetType:'card',targetId:'bad',dataUrl:'data:image/png;base64,aA=='}),/卡牌 ID/);
  assert.throws(()=>parseReferenceUpload({targetType:'lore',targetId:'CHR-W01-001',dataUrl:'data:image/gif;base64,aA=='}),/PNG、JPEG 或 WebP/);
});

test('reference ids are deduplicated and assets become data URLs',()=>{
  const id='ART-1234-ABCD';
  assert.deepEqual(normalizeReferenceAssetIds([id,id]),[id]);
  assert.equal(toReferenceDataUrl({mimeType:'image/webp'},Buffer.from('image')),'data:image/webp;base64,aW1hZ2U=');
  assert.throws(()=>normalizeReferenceAssetIds(Array.from({length:11},(_,index)=>`ART-${index}ABC`)),/最多/);
});
