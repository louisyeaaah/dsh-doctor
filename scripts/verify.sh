#!/usr/bin/env bash
# 静态自检：语法、bundle manifest、patch YAML、纯逻辑单测。不需要 DSH 在跑。
set -uo pipefail
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"
fail=0
step() { printf '\n== %s ==\n' "$1"; }

step '1/4 JS 语法'
for file in lib/*.js scripts/selftest.mjs; do
  if node --check "$file" 2>/dev/null; then echo "  ✓ $file"; else echo "  ✗ $file"; fail=1; fi
done

step '2/4 bundle manifest'
node -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
let bad = 0;
const check = (label, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) bad = 1; };
const patch = pkg.dsh?.bundle?.patch;
check(`dsh.bundle.patch = ${patch ?? "(缺失)"}`, typeof patch === "string" && fs.existsSync(patch));
check("main 存在", fs.existsSync(pkg.main));
check("repository 指向本仓库", typeof pkg.repository?.url === "string" && pkg.repository.url.includes("dsh-doctor"));
check("dsh-plugin 关键词", (pkg.keywords ?? []).includes("dsh-plugin"));
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
  if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
  check(`peer ${name} 带显式预发布分支（${range}）`, /-rc\.[0-9]/.test(range));
}
process.exit(bad);
' || fail=1

step '3/4 cordis.patch.yml 可解析'
python3 -c '
import sys
try:
    import yaml
except ImportError:
    print("  （环境缺 PyYAML，跳过）"); sys.exit(0)
class L(yaml.SafeLoader): pass
L.add_constructor("tag:yaml.org,2002:js", lambda loader, node: None)
docs = list(yaml.load_all(open("cordis.patch.yml", encoding="utf-8"), Loader=L))
assert len(docs) == 1 and isinstance(docs[0], list), "patch 必须是单个列表文档"
print(f"  ✓ cordis.patch.yml 合法（{len(docs[0])} 条）")
' || fail=1

step '4/4 纯逻辑自检'
node scripts/selftest.mjs || fail=1

printf '\n'
[ "$fail" -eq 0 ] && echo "✅ 静态自检通过" || echo "❌ 静态自检失败"
exit "$fail"
