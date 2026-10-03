// 采集诊断事实。只读：不写文件、不改配置、不动任何插件行。
//
// 四类事实：
//   1. 插件行：谁在跑、谁没跑、为什么（disabled / 没有活动 fiber / 加载报错）
//   2. 技能：provider 逐个 list()，把抛错的抓出来（注册表只会跳过它并标记不完整，模型侧看不到）
//   3. patch 行：重复 id、同一包被插了多行、以及 profile 里声明了但没启动的 bundle
//   4. 「改了代码为什么没生效」：HMR 是否 watch 源码、目标模块是否在 node_modules 下

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 读 profile 事实（由 dsh-hmr 使用的同一个服务提供）。 */
export function readProfile(ctx) {
  const profile = ctx.get?.('profileContext');
  if (profile === undefined) return undefined;
  return {
    dir: profile.dir,
    patchPath: profile.patchPath,
    home: profile.home,
    bundles: Array.isArray(profile.startedBundles) ? [...profile.startedBundles] : [],
  };
}

/** 插件行清单。 */
export function collectEntries(ctx) {
  const loader = ctx.get?.('loader');
  if (loader === undefined) return { rows: [], total: 0, active: 0, unavailable: '这个组合里没有 loader 服务' };
  const rows = [];
  for (const entry of loader.entries()) {
    const name = entry.options?.name;
    if (typeof name !== 'string' || name === '' || name.startsWith('cordis:')) continue;
    let id;
    try {
      id = entry.id;
    } catch {
      id = entry.options?.id ?? '?';
    }
    let hasFiber = false;
    try {
      hasFiber = Boolean(entry.fiber?.uid);
    } catch {
      hasFiber = false;
    }
    let disabled = false;
    try {
      disabled = Boolean(entry.disabled);
    } catch {
      disabled = false;
    }
    rows.push({
      id,
      name,
      active: hasFiber,
      disabled,
      state: disabled ? 'disabled' : hasFiber ? 'running' : 'not-running',
      reason: disabled
        ? '这一行在 patch 里被标了 disabled'
        : hasFiber
          ? undefined
          : '有 entry 但没有活动 fiber —— 模块 import 或插件 apply 失败（看宿主日志）',
      engine: name.endsWith('/engine') || name.startsWith('dsh-') ? true : undefined,
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return {
    rows,
    total: rows.length,
    active: rows.filter((row) => row.active).length,
    disabled: rows.filter((row) => row.disabled).length,
    notRunning: rows.filter((row) => row.state === 'not-running').length,
  };
}

/** 技能提供方逐个 list()，把失败原因抓出来。 */
export async function collectSkills(ctx, cwd) {
  const skills = ctx.get?.('skills');
  if (skills === undefined) return { available: false, providers: [], catalog: [], complete: undefined };
  const providers = [];
  const layers = skills.layers ?? {};
  const visit = async (label, holder) => {
    const data = holder?.data;
    if (!(data instanceof Map)) return;
    for (const [name, value] of data) {
      const provider = value?.provider ?? value;
      const row = { layer: label, name: String(name), count: undefined, error: undefined };
      if (typeof provider?.list === 'function') {
        try {
          const result = await provider.list({ cwd });
          row.count = Array.isArray(result) ? result.length : result?.candidates?.length;
          if (Array.isArray(result) === false && result?.complete === false) row.incomplete = true;
        } catch (error) {
          row.error = String(error?.message ?? error);
        }
      }
      providers.push(row);
    }
  };
  await visit('global', layers.global?.providers);
  const scoped = layers.scoped;
  const scopedRows = scoped instanceof Map ? [...scoped.entries()] : [];
  let index = 0;
  for (const [, value] of scopedRows) {
    index += 1;
    await visit(`scope#${index}`, value?.providers);
  }
  let snapshot;
  try {
    snapshot = ctx.get?.('agents')?.currentInitiator?.() !== undefined
      ? await skills.snapshot({ cwd })
      : await skills.snapshot({ cwd });
  } catch (error) {
    snapshot = { skills: [], complete: false, error: String(error?.message ?? error) };
  }
  return {
    available: true,
    providers,
    complete: snapshot?.complete,
    catalog: (snapshot?.skills ?? []).map((skill) => ({
      name: skill.name,
      source: skill.source,
      provider: skill.provider,
      path: skill.path,
    })),
  };
}

/** patch 行扫描：重复 id、同一包多行、声明了没起来的 bundle。 */
export function scanPatch(profile) {
  const result = { path: undefined, exists: false, ids: [], duplicates: [], repeatedNames: [], bundles: [], missingBundles: [] };
  if (profile === undefined) return { ...result, error: '拿不到 profile 信息' };
  const patchPath = profile.patchPath;
  result.path = patchPath;
  if (typeof patchPath !== 'string' || !existsSync(patchPath)) {
    result.error = `读不到 profile patch：${patchPath ?? '(未知路径)'}`;
    return result;
  }
  result.exists = true;
  const text = readFileSync(patchPath, 'utf8');
  const idCount = new Map();
  const nameCount = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const idMatch = /^-\s*id:\s*['"]?([^'"\s]+)['"]?/.exec(line);
    if (idMatch !== null) {
      const id = idMatch[1];
      result.ids.push(id);
      idCount.set(id, (idCount.get(id) ?? 0) + 1);
    }
    const nameMatch = /^name:\s*['"]?([^'"\s]+)['"]?/.exec(line);
    if (nameMatch !== null) nameCount.set(nameMatch[1], (nameCount.get(nameMatch[1]) ?? 0) + 1);
  }
  result.duplicates = [...idCount.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
  result.repeatedNames = [...nameCount.entries()].filter(([, count]) => count > 1).map(([name, count]) => ({ name, count }));
  result.bundles = profile.bundles;
  for (const bundle of profile.bundles) {
    if (typeof bundle !== 'string') continue;
    // @deepseek-ai/* 是随 DSH 一起发行的，从 dsh 安装目录解析，不在 profile/node_modules 里 —— 查它会全是误报
    if (bundle.startsWith('@deepseek-ai/')) continue;
    const dir = profile.dir === undefined ? undefined : join(profile.dir, 'node_modules', bundle);
    if (dir !== undefined && !existsSync(dir)) result.missingBundles.push(bundle);
  }
  return result;
}

/** 「改了代码为什么没生效」：HMR 覆盖情况 + 目标模块位置。 */
export function collectHmr(ctx, query) {
  const hmr = ctx.get?.('hmr');
  const facts = {
    enabled: hmr !== undefined,
    roots: undefined,
    sourceWatching: undefined,
    nodeModulesSkip: true,
    target: undefined,
    verdict: undefined,
    next: undefined,
  };
  if (hmr === undefined) {
    facts.verdict = '这个组合里没有 HMR 服务：任何源码改动都需要重启才生效';
    facts.next = '想不重启就生效，装 dsh-reload 用 reload_plugin 手动重载';
    return facts;
  }
  const config = hmr.config ?? {};
  facts.roots = Array.isArray(config.root) ? config.root : null;
  facts.sourceWatching = Array.isArray(config.root) && config.root.length > 0;
  if (query !== undefined && query !== '') {
    const loader = ctx.get?.('loader');
    const rows = [];
    for (const entry of loader?.entries?.() ?? []) {
      const name = entry.options?.name;
      if (typeof name !== 'string' || !name.includes(query)) continue;
      let id = '?';
      try {
        id = entry.id;
      } catch {
        id = entry.options?.id ?? '?';
      }
      const active = Boolean(entry.fiber?.uid);
      rows.push({ id, name, active, state: active ? 'running' : 'not-running' });
    }
    facts.target = rows;
  }
  if (facts.sourceWatching === false) {
    facts.verdict = 'HMR 的 root 是空数组 —— 不 watch 任何源码文件，所以改代码不会自动生效';
    facts.next = '用 dsh-reload 的 reload_plugin 手动重载插件，或按需要打开 HMR 的 root';
  } else {
    facts.verdict = `HMR 只看 ${JSON.stringify(facts.roots)} 下的文件；位于 node_modules 里的模块仍会被 partialReload() 跳过`;
    facts.next = '装在 profile/node_modules 下的插件不受自动重载覆盖，仍需 reload_plugin';
  }
  return facts;
}

/** 宿主版本与运行环境（诊断里必须带上，否则别人无法复现）。 */
export function collectRuntime(ctx) {
  const facts = {
    node: process.versions.node,
    electron: process.versions.electron,
    platform: `${process.platform} ${process.arch}`,
    dsh: undefined,
    isMac: process.platform === 'darwin',
  };
  try {
    const loader = ctx.get?.('loader');
    const internal = loader?.internal;
    if (internal?.version !== undefined) facts.loaderApi = internal.version;
  } catch {
    // 忽略
  }
  try {
    // DSH 版本可以从 Loader 解析到的 app-boot 包读，但更稳的是问运行时自报
    const pkgPath = process.argv[1];
    if (typeof pkgPath === 'string') facts.entry = pkgPath.replace(/^.*\/(dsh\/node_modules\/[^/]+)\/.*$/, '$1') || undefined;
  } catch {
    // 忽略
  }
  return facts;
}

/** 汇总。 */
export async function collectAll(ctx, { cwd, query } = {}) {
  const profile = readProfile(ctx);
  return {
    runtime: collectRuntime(ctx),
    entries: collectEntries(ctx),
    skills: await collectSkills(ctx, cwd),
    patch: scanPatch(profile),
    profile: profile === undefined ? undefined : { dir: profile.dir, bundles: profile.bundles },
    hmr: collectHmr(ctx, query),
    collectedAt: new Date().toISOString(),
  };
}
