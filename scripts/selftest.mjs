// 纯逻辑自检：不开 DSH 也能跑（脱敏、结论提炼、卡片渲染）。
//
//   node scripts/selftest.mjs
//
// 退出码 0 = 全过。

import { strict as assert } from 'node:assert';

import { findings, redact, renderCard, renderText } from '../lib/render.js';

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${label}\n      ${error.message}`);
  }
}

/** 造一份「哪里都正常」的事实，测试里按需破坏它。 */
function healthyFacts() {
  return {
    collectedAt: '2026-10-03T00:00:00.000Z',
    runtime: { node: '24.18.1', electron: '44.0.0', platform: 'darwin arm64', loaderApi: 'v2' },
    entries: {
      rows: [
        { id: 'a', name: 'pkg-a', state: 'running', active: true, disabled: false },
        { id: 'b', name: 'pkg-b', state: 'running', active: true, disabled: false },
      ],
      total: 2, active: 2, disabled: 0, notRunning: 0,
    },
    skills: {
      available: true, complete: true, catalog: [{ name: 's1', source: 'user-dsh', provider: 'filesystem' }],
      providers: [{ layer: 'global', name: 'filesystem', count: 1, error: undefined }],
    },
    patch: {
      path: '/Users/someone/.dsh/profiles/desktop/cordis.patch.yml',
      exists: true, ids: ['a', 'b'], duplicates: [], repeatedNames: [], bundles: [], missingBundles: [],
    },
    profile: { dir: '/Users/someone/.dsh/profiles/desktop', bundles: [] },
    hmr: { enabled: true, roots: [], sourceWatching: false, nodeModulesSkip: true, verdict: 'HMR 的 root 是空数组', next: '用 reload_plugin' },
  };
}

console.log('脱敏');

await check('家目录被替换', () => {
  const out = redact('/Users/yezhipeng/project/x.txt', { home: '/Users/yezhipeng' });
  assert.ok(out.includes('<HOME>'), out);
  assert.ok(!out.includes('yezhipeng'), out);
});

await check('别人的家目录也会被替换（贴到公开 issue 时同样有效）', () => {
  assert.ok(redact('/Users/stranger/.dsh/x').includes('<HOME>'));
});

await check('token 形态的字符串被替换', () => {
  assert.ok(redact('Authorization: Bearer abcdefghijklmnop1234').includes('<redacted-token>'));
  assert.ok(redact('key=ghp_abcdefghijklmnopqrstuvwx').includes('<redacted-token>'));
});

await check('长 hex 被替换', () => {
  assert.ok(redact('hash 0123456789abcdef0123456789abcdef').includes('<redacted-hex>'));
});

await check('普通文本不受影响', () => {
  assert.equal(redact('plugin row tool-video is not running'), 'plugin row tool-video is not running');
});

await check('回归：include:skill-filesystem 不是 token（曾经被误伤）', () => {
  assert.equal(redact('include:skill-filesystem'), 'include:skill-filesystem');
});

await check('回归：含 sk 的普通标识符不被误伤', () => {
  for (const id of ['include:tool-skill', 'include:skill-badge', 'skill-filesystem', 'tool-sketch']) {
    assert.equal(redact(id), id, `不该脱敏：${id}`);
  }
});

await check('回归：真正的 sk- / ghp_ token 仍会被脱敏', () => {
  assert.ok(redact('key sk-abcdefghijklmnopqrstuvwx').includes('<redacted-token>'));
  assert.ok(redact('ghp_abcdefghijklmnopqrstuvwx').includes('<redacted-token>'));
});

console.log('\n结论提炼');

await check('一切正常时没有 error', () => {
  const list = findings(healthyFacts());
  assert.equal(list.filter((item) => item.level === 'error').length, 0);
});

await check('有行没运行 → error，且带下一步', () => {
  const facts = healthyFacts();
  facts.entries.rows.push({ id: 'c', name: 'pkg-c', state: 'not-running', active: false, disabled: false });
  facts.entries.total = 3;
  facts.entries.notRunning = 1;
  const list = findings(facts);
  const hit = list.find((item) => item.level === 'error');
  assert.ok(hit !== undefined, '应该有 error');
  assert.ok(hit.title.includes('1 个插件行没有在运行'), hit.title);
  assert.ok(typeof hit.next === 'string' && hit.next.length > 0, '必须有下一步');
});

await check('提供方整体失败 → error，并解释「技能会全部不可见」', () => {
  const facts = healthyFacts();
  facts.skills.providers.push({ layer: 'scope#3', name: 'filesystem', error: 'cannot list "…/app.asar/…": Cannot mix BigInt and other types' });
  const list = findings(facts);
  const hit = list.find((item) => item.title.includes('技能提供方整体失败'));
  assert.ok(hit !== undefined, '应该报提供方失败');
  assert.ok(hit.next.includes('全部不可见'), hit.next);
});

await check('patch 重复 id → error', () => {
  const facts = healthyFacts();
  facts.patch.duplicates = [{ id: 'tool-reload', count: 2 }];
  const list = findings(facts);
  assert.ok(list.some((item) => item.level === 'error' && item.title.includes('重复的 entry id')));
});

await check('bundle 没装上 → error', () => {
  const facts = healthyFacts();
  facts.patch.missingBundles = ['dsh-video'];
  assert.ok(findings(facts).some((item) => item.level === 'error' && item.title.includes('第三方 bundle')));
});

await check('disabled 只算 info（是配置不是故障）', () => {
  const facts = healthyFacts();
  facts.entries.rows.push({ id: 'd', name: 'pkg-d', state: 'disabled', active: false, disabled: true });
  facts.entries.disabled = 1;
  const list = findings(facts);
  const hit = list.find((item) => item.title.includes('disabled'));
  assert.equal(hit.level, 'info');
});

await check('HMR 结论总会出现在报告里', () => {
  const list = findings(healthyFacts());
  assert.ok(list.some((item) => item.title === '改了代码为什么没生效'));
});

console.log('\n渲染');

await check('文本报告带环境与下一步', () => {
  const text = renderText(healthyFacts());
  assert.ok(text.includes('DSH 体检报告'));
  assert.ok(text.includes('node 24.18.1'));
  assert.ok(text.includes('改了代码为什么没生效'));
  assert.ok(text.includes('→'), '每条结论都该有 → 下一步');
});

await check('卡片是 markdown 且默认脱敏', () => {
  const facts = healthyFacts();
  facts.entries.rows.push({ id: 'c', name: 'pkg-c', state: 'not-running', active: false, disabled: false });
  facts.entries.notRunning = 1;
  const card = renderCard(facts);
  assert.ok(card.includes('### DSH doctor report'));
  assert.ok(card.includes('Rows not running'));
  assert.ok(!card.includes('someone'), '卡片默认不该出现真实用户名');
  assert.ok(card.includes('<HOME>'));
});

await check('卡片的标题是英文（它要贴进 issue）', () => {
  const facts = healthyFacts();
  facts.entries.rows.push({ id: 'c', name: 'pkg-c', state: 'not-running', active: false, disabled: false });
  facts.entries.notRunning = 1;
  facts.skills.providers.push({ layer: 'scope#3', name: 'filesystem', error: 'boom' });
  const card = renderCard(facts);
  assert.ok(card.includes('plugin row(s) are not running'), '未运行的结论应为英文');
  assert.ok(card.includes('skill provider(s) failed as a whole'), '提供方失败的结论应为英文');
  assert.ok(card.includes('Source-watching is off'), 'HMR 段应为英文');
  assert.ok(!/插件行没有在运行|技能提供方整体失败/.test(card), '卡片里不该出现中文结论标题');
});

await check('卡片可以关掉脱敏', () => {
  const card = renderCard(healthyFacts(), { redacted: false });
  assert.ok(card.includes('/Users/someone'), '不脱敏时应保留原路径');
});

console.log(failures === 0 ? '\n✅ 自检通过' : `\n❌ 自检失败：${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
