// 把采集到的事实渲染成：① 给人看的体检报告 ② 能贴进 issue 的 markdown 卡片。
//
// 只做判断和排版，不采集、不改动任何东西。

import { homedir } from 'node:os';

/** 脱敏：家目录、用户名、疑似 token。诊断卡经常被贴到公开 issue 里。 */
export function redact(text, { home = homedir() } = {}) {
  if (typeof text !== 'string') return text;
  let output = text;
  output = output.split(home).join('<HOME>');
  output = output.replace(/\/Users\/[^/\s'"]+/g, '<HOME>');
  output = output.replace(/\/home\/[^/\s'"]+/g, '<HOME>');
  // 只认「明确的 token 形态」：sk-xxx / ghp_xxx / xoxb-xxx / Bearer xxx。
  // 早期版本用 /(sk|ghp|...)[-_ ]?\w{12,}/，把 include:skill-filesystem 误伤成了 token。
  output = output.replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bpoas]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g, '<redacted-token>');
  output = output.replace(/\b[A-Fa-f0-9]{32,}\b/g, '<redacted-hex>');
  return output;
}

/** 从事实里提炼结论。每条都带「下一步做什么」。 */
export function findings(facts) {
  const out = [];

  // ① 插件行
  const notRunning = facts.entries.rows.filter((row) => row.state === 'not-running');
  const disabled = facts.entries.rows.filter((row) => row.state === 'disabled');
  if (notRunning.length > 0) {
    out.push({
      id: 'rows-not-running',
      level: 'error',
      title: `${notRunning.length} 个插件行没有在运行`,
      detail: notRunning.map((row) => `${row.id}（${row.name}）`).join('、'),
      next: '先看宿主日志里的 import/apply 报错；确认代码没问题后用 reload_plugin 激活，或重启 DSH',
    });
  }
  if (disabled.length > 0) {
    out.push({
      id: 'rows-disabled',
      level: 'info',
      title: `${disabled.length} 个插件行被 disabled`,
      detail: disabled.slice(0, 8).map((row) => row.id).join('、') + (disabled.length > 8 ? ' …' : ''),
      next: '这是配置状态，不是故障：需要就在 profile 的 cordis.patch.yml 里把 disabled 去掉',
    });
  }

  // ② 技能提供方
  const broken = facts.skills.providers.filter((row) => row.error !== undefined);
  if (facts.skills.available === false) {
    out.push({ id: 'no-skill-registry', level: 'info', title: '这个组合里没有技能注册表', detail: 'ctx.skills 不存在', next: '技能相关诊断跳过' });
  }
  if (broken.length > 0) {
    out.push({
      id: 'providers-failed',
      level: 'error',
      title: `${broken.length} 个技能提供方整体失败`,
      detail: broken.map((row) => `${row.layer}/${row.name}: ${row.error}`).join('\n'),
      next: '注册表遇到失败会跳过该提供方并标记观察不完整 —— 所以它的技能在会话里全部不可见。'
        + '典型原因：某个技能根目录读不了（例如 app.asar 内的目录）。',
    });
  }
  if (facts.skills.complete === false && broken.length === 0) {
    out.push({
      id: 'skills-incomplete',
      level: 'warn',
      title: '技能目录的本次观察不完整',
      detail: '有提供方没有正常返回，但没有抛错',
      next: '用 reload_skill 再刷一次；仍不完整就看宿主日志',
    });
  }

  // ③ patch
  if (facts.patch.exists === true) {
    if (facts.patch.duplicates.length > 0) {
      out.push({
        id: 'patch-duplicate-ids',
        level: 'error',
        title: 'patch 里有重复的 entry id',
        detail: facts.patch.duplicates.map((item) => `${item.id} 出现 ${item.count} 次`).join('、'),
        next: '重复 id 会让 Loader 组装出非预期的行；改成唯一 id',
      });
    }
    if (facts.patch.repeatedNames.length > 0) {
      out.push({
        id: 'patch-repeated-names',
        level: 'warn',
        title: '同一个包在 patch 里被插了多行',
        detail: facts.patch.repeatedNames.map((item) => `${item.name} × ${item.count}`).join('、'),
        next: '多半是手写安装脚本重复追加；确认是否故意（一个包挂多行是合法的，但常常是失误）',
      });
    }
    if (facts.patch.missingBundles.length > 0) {
      out.push({
        id: 'bundles-missing',
        level: 'error',
        title: 'profile 声明了但没装上的第三方 bundle',
        detail: facts.patch.missingBundles.join('、'),
        next: '用插件管理器重装，或在该 profile 里跑一次 pnpm install',
      });
    }
  }

  // ④ HMR
  out.push({
    id: 'hmr-verdict',
    level: 'info',
    title: '改了代码为什么没生效',
    detail: facts.hmr.verdict,
    next: facts.hmr.next,
  });

  return out;
}

/** 给人看的体检报告。 */
export function renderText(facts, { redacted = true } = {}) {
  const clean = (value) => (redacted ? redact(String(value)) : String(value));
  const lines = [];
  const problems = findings(facts);
  const errors = problems.filter((item) => item.level === 'error');
  const warns = problems.filter((item) => item.level === 'warn');

  lines.push('DSH 体检报告');
  lines.push(`  采集时间   ${facts.collectedAt}`);
  lines.push(`  运行环境   node ${facts.runtime.node}${facts.runtime.electron ? ` / Electron ${facts.runtime.electron}` : ''} · ${facts.runtime.platform}`);
  if (facts.runtime.loaderApi !== undefined) lines.push(`  Loader API ${facts.runtime.loaderApi}`);
  lines.push('');
  lines.push(`插件行     ${facts.entries.active} 运行中 / ${facts.entries.total} 总行数`
    + `${facts.entries.disabled ? `（${facts.entries.disabled} disabled）` : ''}`
    + `${facts.entries.notRunning ? ` —— ${facts.entries.notRunning} 行没有运行` : ''}`);
  lines.push(`技能       ${facts.skills.available === false ? '无注册表' : `${facts.skills.catalog.length} 个可见；提供方 ${facts.skills.providers.length} 个`
    + `${facts.skills.providers.filter((row) => row.error !== undefined).length > 0 ? '（有失败）' : ''}`}`);
  lines.push(`patch      ${facts.patch.exists === true ? clean(facts.patch.path) : `读取失败：${clean(facts.patch.error ?? '')}`}`);
  lines.push('');

  if (problems.length === 0) {
    lines.push('✅ 没发现异常。');
  } else {
    lines.push(`结论：${errors.length} 个问题${warns.length ? `，${warns.length} 个警告` : ''}。`);
    for (const item of problems) {
      const mark = item.level === 'error' ? '❌' : item.level === 'warn' ? '⚠️' : 'ℹ️';
      lines.push('');
      lines.push(`${mark} ${item.title}`);
      if (item.detail !== undefined && item.detail !== '') {
        for (const line of String(item.detail).split('\n')) lines.push(`   ${clean(line)}`);
      }
      if (item.next !== undefined) lines.push(`   → ${item.next}`);
    }
  }
  return lines.join('\n');
}

/** 卡片的英文文案（卡片是贴到公开 issue 里的，标题保持英文）。 */
const CARD_TEXT = {
  'rows-not-running': { title: (n) => `${n} plugin row(s) are not running`, next: 'Check the host log for the import/apply error; once the code is fine, activate the row with reload_plugin or restart DSH.' },
  'rows-disabled': { title: (n) => `${n} plugin row(s) are disabled`, next: 'This is configuration, not a failure: remove `disabled` in the profile cordis.patch.yml if you want them on.' },
  'no-skill-registry': { title: () => 'No skill registry in this composition' },
  'providers-failed': { title: (n) => `${n} skill provider(s) failed as a whole`, next: 'A failing provider is skipped and the observation is marked incomplete — every skill it owns becomes invisible. Usual cause: one unreadable skill root (e.g. a directory inside app.asar).' },
  'skills-incomplete': { title: () => 'The skill observation was incomplete' },
  'patch-duplicate-ids': { title: () => 'Duplicate entry ids in the patch', next: 'Duplicate ids make the Loader assemble unintended rows; give each row a unique id.' },
  'patch-repeated-names': { title: () => 'The same package is inserted more than once', next: 'Usually an install script appending twice. Legal, but often a mistake — confirm it is intentional.' },
  'bundles-missing': { title: () => 'Declared third-party bundles that are not installed', next: 'Reinstall through the plugin manager, or run pnpm install in that profile.' },
  'hmr-verdict': { title: () => 'Why an edited plugin did not take effect' },
};

/** 能直接贴进 issue 的 markdown 卡片。 */
export function renderCard(facts, { redacted = true } = {}) {
  const clean = (value) => (redacted ? redact(String(value)) : String(value));
  const problems = findings(facts);
  const lines = [];
  lines.push('<!-- dsh-doctor -->');
  lines.push('### DSH doctor report');
  lines.push('');
  lines.push(`- collected: ${facts.collectedAt}`);
  lines.push(`- node: ${facts.runtime.node}${facts.runtime.electron ? ` / Electron ${facts.runtime.electron}` : ''}`);
  lines.push(`- platform: ${facts.runtime.platform}`);
  if (facts.runtime.loaderApi !== undefined) lines.push(`- loader API: ${facts.runtime.loaderApi}`);
  lines.push(`- plugin rows: ${facts.entries.active} running / ${facts.entries.total} total`
    + `${facts.entries.disabled ? `, ${facts.entries.disabled} disabled` : ''}`
    + `${facts.entries.notRunning ? `, ${facts.entries.notRunning} NOT RUNNING` : ''}`);
  if (facts.skills.available !== false) {
    lines.push(`- skills: ${facts.skills.catalog.length} visible, ${facts.skills.providers.length} providers`);
  }
  lines.push('');

  const errors = problems.filter((item) => item.level === 'error');
  if (errors.length > 0) {
    lines.push('#### Problems');
    for (const item of errors) {
      const english = CARD_TEXT[item.id];
      const title = english?.title !== undefined
        ? english.title(Number((item.title.match(/^(\d+)/) ?? [])[1] ?? 0))
        : clean(item.title);
      lines.push(`- **${clean(title)}**`);
      if (item.detail !== undefined) {
        lines.push('  ```');
        for (const line of String(item.detail).split('\n').slice(0, 12)) lines.push(`  ${clean(line)}`);
        lines.push('  ```');
      }
    }
    lines.push('');
  }

  if (facts.entries.notRunning > 0) {
    lines.push('#### Rows not running');
    lines.push('| id | package | state |');
    lines.push('| --- | --- | --- |');
    for (const row of facts.entries.rows.filter((item) => item.state === 'not-running').slice(0, 20)) {
      lines.push(`| ${clean(row.id)} | ${clean(row.name)} | not-running |`);
    }
    lines.push('');
  }

  const brokenProviders = facts.skills.providers.filter((row) => row.error !== undefined);
  if (brokenProviders.length > 0) {
    lines.push('#### Failing skill providers');
    for (const row of brokenProviders) {
      lines.push(`- \`${clean(row.layer)}/${clean(row.name)}\`: ${clean(row.error)}`);
    }
    lines.push('');
  }

  if (facts.patch.exists === true) {
    lines.push('#### Profile');
    lines.push(`- patch: \`${clean(facts.patch.path)}\``);
    lines.push(`- entry ids: ${facts.patch.ids.length}`);
    if (facts.patch.duplicates.length > 0) lines.push(`- duplicate ids: ${facts.patch.duplicates.map((item) => clean(item.id)).join(', ')}`);
    lines.push('');
  }

  lines.push('#### HMR');
  lines.push(`- root: ${JSON.stringify(facts.hmr.roots ?? null)}`);
  lines.push(`- ${facts.hmr.sourceWatching === true
    ? 'Source-watching is on, but modules under node_modules are still skipped by partialReload().'
    : 'Source-watching is off (HMR root is empty), so editing a plugin never takes effect by itself. Use reload_plugin or enable the HMR root.'}`);
  lines.push('');
  lines.push('<sub>generated by dsh-doctor — read-only, nothing was modified.</sub>');
  return lines.join('\n');
}
