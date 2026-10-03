#!/usr/bin/env bash
# 把 dsh-doctor 装进一个 DSH profile。
#
#   scripts/install.sh [profile]        # 默认 desktop
#
# 做三件事：
#   1. 把插件包实体拷到 <profile>/node_modules/dsh-doctor（必须实体拷贝）
#   2. 把 cordis.patch.yml 里的插件行并入 profile 的 patch 层（带标记，便于回滚）
#   3. 把技能装到 $DSH_HOME/skills/dsh-doctor/
#
# 写入后会校验 patch 文件仍可解析；不通过自动还原备份。
# 正常情况下**不需要重启**：DSH 会热组装新增的 patch 行。
# 如果没生效，先用 /reload-skill 刷新技能，再考虑重启。
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="dsh-doctor"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${1:-desktop}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH="$PROFILE_DIR/cordis.patch.yml"
DEST="$PROFILE_DIR/node_modules/$PKG_NAME"
BEGIN_MARK="# >>> $PKG_NAME (managed by scripts/install.sh) >>>"
END_MARK="# <<< $PKG_NAME <<<"

say() { printf '%s\n' "$*"; }

[ -d "$PROFILE_DIR" ] || { say "找不到 profile 目录：$PROFILE_DIR"; exit 1; }

say "profile : $PROFILE_DIR"

# ── 1. 插件包实体 ─────────────────────────────────────────────────────────
rm -rf "$DEST"
mkdir -p "$DEST"
for item in lib skills package.json cordis.patch.yml README.md DESIGN.md; do
  [ -e "$PKG_DIR/$item" ] && cp -R "$PKG_DIR/$item" "$DEST/"
done
say "插件    : $DEST"

# ── 2. patch 层 ───────────────────────────────────────────────────────────
if [ -f "$PATCH" ]; then
  cp "$PATCH" "$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
fi
python3 - "$PATCH" "$BEGIN_MARK" "$END_MARK" "$DEST/cordis.patch.yml" <<'PY'
import re, sys
patch, begin, end, snippet = sys.argv[1:5]
try:
    text = open(patch, encoding='utf-8').read()
except FileNotFoundError:
    text = '[]\n'
block = begin + '\n' + open(snippet, encoding='utf-8').read().rstrip('\n') + '\n' + end + '\n'
# 先删旧块（幂等），再追加
text = re.sub(re.escape(begin) + r'.*?' + re.escape(end) + r'\n?', '', text, flags=re.S)
if text.strip() in ('', '[]'):
    text = ''
if not text.endswith('\n'):
    text += '\n'
text += '\n' + block
open(patch, 'w', encoding='utf-8').write(text)
PY
if ! python3 "$PKG_DIR/scripts/validate-patch.py" "$PATCH"; then
  latest="$(ls -t "$PATCH".bak-* 2>/dev/null | head -1 || true)"
  [ -n "$latest" ] && cp "$latest" "$PATCH" && say "patch 校验失败，已还原：$latest"
  exit 1
fi
say "patch   : $PATCH"

# ── 3. 技能 ───────────────────────────────────────────────────────────────
SKILL_SRC="$PKG_DIR/skills/$PKG_NAME/SKILL.md"
SKILL_DEST="$DSH_HOME/skills/$PKG_NAME"
if [ -f "$SKILL_SRC" ]; then
  mkdir -p "$SKILL_DEST"
  cp "$SKILL_SRC" "$SKILL_DEST/SKILL.md"
  say "技能    : $SKILL_DEST/SKILL.md"
fi

say ""
say "装完了。正常情况下不必重启：新 patch 行会被运行中的 DSH 热组装。"
say "验证：让 agent 调 reload_plugin({}) 看清单，或敲 /reload-skill。"
say "没生效时：先 /reload-skill，再确认 profile 没被别的进程改过。"
