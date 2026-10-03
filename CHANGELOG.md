# Changelog

## 0.1.0 — 首个版本

- `dsh_doctor` 工具 + `/dsh-doctor` 命令：一条只读命令体检四类故障
  ① 插件行没运行（disabled / 没有活动 fiber）② 技能提供方整体失败
  ③ patch 重复 id / 同一包多行 / 声明了没装上的 bundle
  ④ 「改了代码为什么没生效」（HMR root 是否为空、node_modules 是否被跳过）
- `card: true` 输出可贴进 issue 的 markdown 卡片，**默认脱敏**（家目录、用户名、疑似 token）
- 只读：不写配置、不改 patch、不动任何插件行；每条结论都带「下一步做什么」
- 15 项纯逻辑自检（脱敏 / 结论提炼 / 渲染），`node scripts/selftest.mjs` 可离线跑
