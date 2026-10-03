#!/usr/bin/env python3
"""校验一个 DSH profile 的 cordis.patch.yml 是否还能被解析。

和 dsh-personal-assistant 用的是同一份校验（那边踩过追加成两个 YAML 文档的坑）：
DSH 自己的 loader 认识 `!!js` 标签，标准 YAML 解析器不认识——这里按"原样保留"
处理，只检查结构：

  - 必须**只有一个** YAML 文档（append 出错最常见的后果就是变成两个根节点）
  - 根节点必须是列表（或空）

退出码 0 = 通过；1 = 不通过（原因写到 stderr）；79 = 环境缺 PyYAML，跳过。
"""
import sys

try:
    import yaml
except ImportError:
    print("skip: PyYAML 不可用，跳过结构校验", file=sys.stderr)
    sys.exit(79)


class Loader(yaml.SafeLoader):
    """把 !!js 当成不透明标量。"""


Loader.add_constructor("tag:yaml.org,2002:js", lambda loader, node: None)


def main(argv):
    if len(argv) != 2:
        print("用法: validate-patch.py <cordis.patch.yml>", file=sys.stderr)
        return 2
    path = argv[1]
    try:
        with open(path, encoding="utf-8") as handle:
            docs = list(yaml.load_all(handle, Loader=Loader))
    except yaml.YAMLError as error:
        print(f"{path}: YAML 解析失败：{error}", file=sys.stderr)
        return 1

    if len(docs) != 1:
        print(f"{path}: 期望 1 个 YAML 文档，实际 {len(docs)} 个（多半是往非空数组后面又追加了一个根节点）", file=sys.stderr)
        return 1

    root = docs[0]
    if root is not None and not isinstance(root, list):
        print(f"{path}: 根节点必须是列表，实际是 {type(root).__name__}", file=sys.stderr)
        return 1

    print(f"{path}: OK（{len(root or [])} 条 patch 记录）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
