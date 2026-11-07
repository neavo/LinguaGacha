"""修复生成类型树并核对 MonoBehaviour 头部。"""

from collections.abc import Collection
from typing import Any

from UnityPy.files.ObjectReader import ObjectReader
from UnityPy.helpers.TypeTreeNode import TYPETREENODE_KEYS, TypeTreeNode

ALIGN_BYTES = 0x4000
MANAGED_REFERENCE_TYPES = frozenset(("managedReference", "ManagedReferencesRegistry"))


def repair_generated_tree(
    root: TypeTreeNode, unserialized_fields: Collection[str] = ()
) -> TypeTreeNode:
    """返回修复后的独立节点，多态引用交由调用者单独调查。

    `unserialized_fields` 是调用者按程序集签名确认不参与 Unity 序列化的字段路径，
    例如 `grid` 或 `settings.cells`。生成器会把多维数组等字段误加入类型树，节点本身无法区分。
    """
    nodes = []
    path: list[str] = []
    skipped = set()
    skip_level = None
    for node in root.traverse():
        if skip_level is not None and node.m_Level > skip_level:
            continue
        skip_level = None
        del path[node.m_Level :]
        path.append(node.m_Name)
        field = ".".join(path[1:])
        if field in unserialized_fields:
            skipped.add(field)
            skip_level = node.m_Level
            continue
        if node.m_Type in MANAGED_REFERENCE_TYPES:
            raise NotImplementedError(f"多态引用需要单独解析：{node.m_Name} ({node.m_Type})")

        # 重建独立节点，避免修复影响调用者缓存的原始类型树。
        fields = {
            key: getattr(node, key)
            for key in TYPETREENODE_KEYS
            if key != "m_Children"
        }
        if node.m_Children and node.m_Children[0].m_Type == "Array":
            data = next(
                (child for child in node.m_Children[0].m_Children if child.m_Name == "data"),
                None,
            )
            # 普通字符串的元素是 `char`，`List<string>` 的元素才与外层同为 `string`。
            if data is not None and data.m_Type == node.m_Type:
                fields["m_Type"] = "vector"
        if node.m_Level == 1 and node.m_Name == "m_Enabled":
            fields["m_MetaFlag"] = (node.m_MetaFlag or 0) | ALIGN_BYTES
        nodes.append(fields)

    missing = set(unserialized_fields) - skipped
    if missing:
        raise ValueError(f"生成节点中没有这些字段：{sorted(missing)}")
    return TypeTreeNode.from_list(nodes)


def read_monobehaviour(
    obj: ObjectReader,
    generated_nodes: TypeTreeNode | None = None,
    unserialized_fields: Collection[str] = (),
) -> tuple[dict[str, Any], TypeTreeNode]:
    """优先使用资源类型树，返回通过长度与头部检查的数据及写回节点。"""
    nodes = obj.serialized_type.node if obj.serialized_type else None
    if nodes is None:
        if generated_nodes is None:
            raise ValueError("缺少完整类型树，需要提供生成节点")
        nodes = repair_generated_tree(generated_nodes, unserialized_fields)

    head = obj.parse_monobehaviour_head()
    tree = obj.read_typetree(nodes=nodes, check_read=True)
    script = tree["m_Script"]
    expected = (head.m_Script.m_FileID, head.m_Script.m_PathID)
    actual = (script["m_FileID"], script["m_PathID"])
    if actual != expected:
        raise ValueError(
            f"脚本引用不一致：{obj.assets_file.name}:{obj.path_id}，"
            f"类型树 {actual}，对象头部 {expected}"
        )
    return tree, nodes
