# dsh-doctor

**「插件装了没反应」不该靠猜。** 一条只读命令体检 DSH，输出问题清单 + 每条的下一步。

```sh
dsh_doctor()                  # 体检：插件行 / 技能提供方 / patch / HMR
dsh_doctor({ card: true })    # 输出可贴进 issue 的 markdown 卡片（默认脱敏）
/dsh-doctor card              # 人也可以直接敲
```

## 它查什么（四类，都是真实踩过的）

| 段 | 查什么 | 典型症状 |
| --- | --- | --- |
| ① 插件行 | 哪些行没在运行、哪些被 disabled、为什么 | 「我装了插件但工具没出现」 |
| ② 技能提供方 | 逐个 provider 调 `list()`，把抛错的抓出来 | 「磁盘上有技能，会话里一个都看不见」 |
| ③ patch 层 | 重复 entry id、同一包多行、声明了没装上的 bundle | 「装了但没生效 / 行为诡异」 |
| ④ HMR | 是否 watch 源码、`node_modules` 是否被跳过 | 「改了插件代码没反应」 |

**重点在 ②**：技能注册表遇到某个 provider 抛错时只会**跳过它并标记观察不完整** ——
模型侧完全看不到诊断信息。dsh-doctor 把那条错误原文摊开给你看。

## 为什么值得单独做一个

DSH 里三类完全不同的故障，在界面上长得一模一样：插件行没起来、技能提供方整体失败、
patch 行冲突。用户只能反复重启碰运气。dsh-doctor 把它们分开，并且**每条结论都带下一步动作**。

## 与同名包的区别（重要）

npm 上已有一个 [`dsh-doctor`](https://github.com/astra3294/dsh-doctor)（0.4.3，5 stars），
做的是**诊断 + 恢复**：浏览器侧有个 Doctor 按钮、宿主侧有恢复服务、还有启动探针和一键回滚到上一个健康检查点。
它比这个仓库成熟得多。**如果你要的是「坏了能救回来」，装它的。**

本仓库这个做的是另一件事：**只读地把「为什么」讲清楚** ——
哪个插件行没运行、哪个技能提供方整体失败、patch 里有没有重复 id，
并且把结论变成一张**默认脱敏、可以直接贴进 issue 的英文卡片**。它不改任何东西、也不会替你恢复。

本仓库没有发布到 npm（名字也被占了），安装走 GitHub 路径或 `scripts/install.sh`。

## 安装

```sh
dsh plugin --profile <profile> add github:louisyeaaah/dsh-doctor
```

或本仓库内：

```sh
scripts/install.sh [profile]     # 拷进 profile + 合并 patch 行
scripts/verify.sh                # 静态自检（不需要 DSH 在跑）
```

## 输出示例

```
DSH 体检报告
  采集时间   2026-10-03T03:45:00.000Z
  运行环境   node 24.18.1 / Electron 44.0.0 · darwin arm64
  Loader API v2

插件行     180 运行中 / 206 总行数（26 disabled）
技能       12 个可见；提供方 7 个（有失败）
patch      <HOME>/.dsh/profiles/desktop/cordis.patch.yml

结论：1 个问题，1 个警告。

❌ 1 个技能提供方整体失败
   scope#3/filesystem: cannot list "<HOME>/…/app.asar/…/dsh-agent-preset/skills":
   Cannot mix BigInt and other types, use explicit conversions
   → 注册表遇到失败会跳过该提供方并标记观察不完整 —— 所以它的技能在会话里全部不可见。
     典型原因：某个技能根目录读不了（例如 app.asar 内的目录）。

ℹ️ 改了代码为什么没生效
   HMR 的 root 是空数组 —— 不 watch 任何源码文件，所以改代码不会自动生效
   → 用 dsh-reload 的 reload_plugin 手动重载插件，或按需要打开 HMR 的 root
```

## 脱敏

体检卡默认把家目录替换成 `<HOME>`、把疑似 token 替换成 `<redacted-token>`、长 hex 替换成
`<redacted-hex>` —— 因为它就是拿来贴到公开 issue 里的。要看原文传 `raw: true`。

## 只读保证

不写任何文件、不改 profile、不动 Loader 树里的任何行。唯一的副作用是在页面/引擎里调用
各 provider 的 `list()`（注册表本来也会调）。

## 已知限制

- 依赖宿主内部结构（`ctx.loader` / `ctx.skills` / `ctx.hmr` / `profileContext`）。
  DSH 升级后可能失效 —— 输出里始终带 Node / Electron / Loader API 版本，方便定位。
- 「插件行为不对」查不出来：它只回答**加载与可见性**层面的问题。
- 技能提供方的 `list()` 会被真的调用一次：极慢的 provider 会让体检变慢。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 插件入口：`dsh_doctor` 工具 + `/dsh-doctor` 命令 |
| `lib/collect.js` | 只读采集四类事实 |
| `lib/render.js` | 脱敏、结论提炼、文本报告与 markdown 卡片 |
| `scripts/selftest.mjs` | 15 项纯逻辑自检（脱敏 / 结论 / 渲染） |
| `scripts/verify.sh` | 静态自检（语法 + manifest + patch + 单测） |

---

作者 [@louisyeaah](https://x.com/louisyeaah)（悉尼）—— 发了什么、翻车了什么都会写。
作品站：[louisyeaaah.github.io](https://louisyeaaah.github.io) · 全部工具：[github.com/louisyeaaah](https://github.com/louisyeaaah)
