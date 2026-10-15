import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Dockerfile 用显式文件白名单把服务端模块 COPY 进镜像。新增模块若忘记登记，
// 镜像能构建成功但容器启动即 ERR_MODULE_NOT_FOUND，所以这里做传递闭包校验。
const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);

async function localImports(file) {
  const source = await readFile(new URL(file, root), 'utf8');
  return [...source.matchAll(/from\s+'\.\/([A-Za-z0-9._-]+\.mjs)'/g)].map(match => match[1]);
}

function copiedRootModules() {
  const lines = dockerfile.split('\n').filter(line => /^COPY\s+.+\s\.\/\s*$/.test(line));
  return new Set(lines.flatMap(line => line.replace(/^COPY\s+/, '').replace(/\s+\.\/\s*$/, '').split(/\s+/)).filter(Boolean));
}

test('every server module reachable from server.mjs is copied into the image', async () => {
  const copied = copiedRootModules();
  assert.ok(copied.has('server.mjs'), 'Dockerfile 应该 COPY server.mjs');
  const seen = new Set(['server.mjs']);
  const queue = ['server.mjs'];
  while (queue.length) {
    const file = queue.pop();
    for (const dependency of await localImports(file)) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      queue.push(dependency);
    }
  }
  assert.ok(seen.size > 5, `应该解析出服务端模块闭包，实际 ${seen.size}`);
  assert.deepEqual([...seen].filter(file => !copied.has(file)).sort(), []);
});

test('the agent modules are part of that closure and exist on disk', async () => {
  const copied = copiedRootModules();
  for (const file of ['ai-tools.mjs', 'ai-agent.mjs']) {
    assert.ok(copied.has(file), `${file} 应该被 COPY`);
    const source = await readFile(new URL(file, root), 'utf8');
    assert.ok(source.length > 500, `${file} 应该有实际内容`);
  }
});

test('the image still excludes design sources and secrets', async () => {
  const source = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
  for (const entry of ['.git', '.env.local', 'docs', 'tests']) {
    assert.match(source, new RegExp(`^${entry.replace('.', '\\.')}$`, 'm'));
  }
});
