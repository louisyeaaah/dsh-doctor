// dsh-doctor 插件入口。
//
// 只读诊断：
//   dsh_doctor()           一条命令体检，输出问题清单 + 每条的下一步
//   dsh_doctor({ card:true })  输出可贴进 issue 的 markdown 卡片（默认脱敏）
//   /dsh-doctor            人也可以直接敲
//
// 它解决的问题：DSH 的故障在用户侧统一表现为「我装了但没反应」——
// 插件行没起来、技能提供方整体失败、patch 重复 id，三种原因在界面上长得一模一样。
// 这个插件把它们分开，并把结论变成一张可以贴出去求助的卡片。

import { CommandDefinitionId } from '@deepseek-ai/dsh-commands';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { collectAll } from './collect.js';
import { findings, renderCard, renderText } from './render.js';

export const name = 'dsh-doctor';

/** 只硬依赖工具注册表；loader / skills / hmr / profileContext / commands 都是可选的。 */
export const inject = ['tools'];

export const Config = z.object({
  /** 体检卡是否脱敏（家目录、用户名、疑似 token）。默认 true。 */
  redact: z.boolean().default(true),
});

const VERSION = '0.1.0';

function resolveCwd(value, exec) {
  if (typeof value === 'string' && value.trim() !== '') return value;
  return exec?.agent?.session?.header?.cwd ?? process.cwd();
}

async function diagnose(ctx, settings, { cwd, query, card }) {
  const facts = await collectAll(ctx, { cwd, query });
  const redacted = settings.redact !== false;
  const report = card === true ? renderCard(facts, { redacted }) : renderText(facts, { redacted });
  const problems = findings(facts);
  return {
    ok: problems.filter((item) => item.level === 'error').length === 0,
    report: `${report}\n\n— dsh-doctor v${VERSION}`,
    counts: {
      pluginRows: facts.entries.total,
      running: facts.entries.active,
      notRunning: facts.entries.notRunning,
      disabled: facts.entries.disabled,
      skills: facts.skills.catalog.length,
      failingProviders: facts.skills.providers.filter((row) => row.error !== undefined).length,
      errors: problems.filter((item) => item.level === 'error').length,
    },
  };
}

export function apply(ctx, config) {
  const settings = { redact: config.redact !== false };

  ctx.tools.register(defineTool({
    name: 'dsh_doctor',
    description: '只读体检 DSH：哪些插件行没有运行、哪个技能提供方整体失败、patch 里有没有重复 id、'
      + '以及「改了插件代码为什么没生效」。每条结论都带下一步动作。'
      + '传 card: true 会输出一张脱敏的 markdown 卡片，可直接贴进 issue 求助。'
      + '它只读，不改任何配置、不动任何插件行。',
    parameters: {
      card: { type: 'boolean', description: '输出可贴进 issue 的 markdown 卡片（默认脱敏）。默认 false。' },
      query: { type: 'string', description: '可选：只看某个包名/插件行 id 的加载情况。' },
      cwd: { type: 'string', description: '可选：按该目录解析技能根，默认会话工作目录。' },
      raw: { type: 'boolean', description: '设为 true 时体检卡不脱敏（默认脱敏）。' },
    },
    timeoutMs: 60000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(args, exec) {
      const settingsForCall = { redact: args.raw === true ? false : settings.redact };
      const { report, ok } = await diagnose(ctx, settingsForCall, {
        cwd: resolveCwd(args.cwd, exec),
        query: args.query,
        card: args.card === true,
      });
      return { ok, report };
    },
  }));

  ctx.inject(['commands'], (scoped) => {
    scoped.commands.register({
      definitionId: CommandDefinitionId('dsh-doctor'),
      name: 'dsh-doctor',
      description: '只读体检 DSH（插件行 / 技能提供方 / patch / HMR）',
      input: { hint: '[card] 传 card 输出可贴 issue 的卡片' },
      handler: async (invocation) => {
        const wantsCard = (invocation.rawInput ?? '').trim().toLowerCase().includes('card');
        const cwd = invocation.agent?.session?.header?.cwd ?? process.cwd();
        const { report } = await diagnose(scoped, settings, { cwd, card: wantsCard });
        return { kind: 'success', text: report };
      },
    });
  });
}
