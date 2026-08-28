import type { Root } from "mdast";
import type { Node, Position } from "unist";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

export type MarkdownV2Unit = {
  kind: string; // mdast 节点类型，仅参与解析判定和迁移期块配对
  start_offset: number; // 原文半开区间起点
  end_offset: number; // 原文半开区间终点
  start_line: number; // 0-based 块起始物理行，也是 Item.row
  end_line: number; // 0-based 块结束物理行
  start_column: number; // 0-based 首行内容起点，供 V1 译文 fallback 去掉容器前缀
  before: string; // 前一块末尾到本块起点之间的原始布局
  after: string; // 只由最后一块持有的文档尾部布局
  src: string; // 当前块原文；资源 destination 已投影为短 token
  excluded: boolean; // 当前块是否跳过翻译
};

export type MarkdownV2Document = {
  units: MarkdownV2Unit[]; // 按原文顺序排列且互不重叠的写回单元
  resources: ReadonlyMap<string, string>; // token 到原始 destination 的文档内映射
};

type MarkdownNode = Node & {
  type: string;
  children?: MarkdownNode[];
  value?: unknown;
  alt?: unknown;
  url?: unknown;
};

type ResourceKind = "link" | "image" | "definition";

type TextReplacement = {
  start_offset: number;
  end_offset: number;
  replacement: string;
};

// 容器只提供 Markdown 骨架，排除类节点和资源节点分别决定翻译范围与 destination 投影。
const STRUCTURAL_CONTAINER_KINDS = new Set(["root", "list", "listItem", "blockquote"]);
const EXCLUDED_KINDS = new Set(["code", "html", "thematicBreak", "definition", "yaml", "toml"]);
const RESOURCE_KINDS = new Set<ResourceKind>(["link", "image", "definition"]);
const RESOURCE_TOKEN_PREFIX = "lg-resource:";
const MARKDOWN_PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"]);

/**
 * 把 Markdown 解析为互不重叠的块单元，并把资源 destination 投影为短引用。
 */
export function parse_markdown_v2_document(text: string): MarkdownV2Document {
  const tree = MARKDOWN_PROCESSOR.parse(text) as Root as MarkdownNode;
  const nodes = collect_atomic_nodes(tree).sort(compare_node_position);
  if (nodes.length === 0) {
    return {
      units: [
        {
          kind: "document",
          start_offset: 0,
          end_offset: text.length,
          start_line: 0,
          end_line: 0,
          start_column: 0,
          before: text,
          after: "",
          src: "",
          excluded: true,
        },
      ],
      resources: new Map(),
    };
  }

  const { replacements, resources } = collect_resource_replacements(tree, text);
  const units: MarkdownV2Unit[] = [];
  let cursor = 0;
  for (const node of nodes) {
    const position = node.position as Position;
    const start_offset = position.start.offset as number;
    const end_offset = position.end.offset as number;
    const local_replacements = replacements
      .filter(
        (replacement) =>
          replacement.start_offset >= start_offset && replacement.end_offset <= end_offset,
      )
      .map((replacement) => ({
        ...replacement,
        start_offset: replacement.start_offset - start_offset,
        end_offset: replacement.end_offset - start_offset,
      }));
    units.push({
      kind: node.type,
      start_offset,
      end_offset,
      start_line: position.start.line - 1,
      end_line: position.end.line - 1,
      start_column: position.start.column - 1,
      before: text.slice(cursor, start_offset),
      after: "",
      src: apply_replacements(text.slice(start_offset, end_offset), local_replacements),
      excluded: EXCLUDED_KINDS.has(node.type) || !contains_translatable_text(node),
    });
    cursor = end_offset;
  }
  const last_unit = units.at(-1) as MarkdownV2Unit;
  last_unit.after = text.slice(cursor);
  return { units, resources };
}

/**
 * 只恢复仍处于 Markdown destination 位置的首个合法资源 token，其余译文保持原样。
 */
export function restore_markdown_v2_resources(
  text: string,
  resources: ReadonlyMap<string, string>,
): string {
  if (resources.size === 0 || !text.includes(RESOURCE_TOKEN_PREFIX)) {
    return text;
  }
  let tree: MarkdownNode;
  try {
    tree = MARKDOWN_PROCESSOR.parse(text) as Root as MarkdownNode;
  } catch {
    return text;
  }

  const consumed_tokens = new Set<string>();
  const replacements: TextReplacement[] = [];
  visit_nodes(tree, (node) => {
    if (!is_resource_node(node) || typeof node.url !== "string") {
      return;
    }
    const token = node.url;
    if (consumed_tokens.has(token) || !resources.has(token)) {
      return;
    }
    const range = find_unique_text_range(text, node.position, token);
    if (range === null) {
      return;
    }
    replacements.push({ ...range, replacement: resources.get(token) as string });
    consumed_tokens.add(token);
  });
  return apply_replacements(text, replacements);
}

/** 展开结构容器并保留最外层可独立写回节点，避免父子范围重叠。 */
function collect_atomic_nodes(tree: MarkdownNode): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  const visit = (node: MarkdownNode): void => {
    if (STRUCTURAL_CONTAINER_KINDS.has(node.type)) {
      for (const child of node.children ?? []) {
        visit(child);
      }
      return;
    }
    if (has_offset_position(node.position)) {
      result.push(node);
    }
  };
  visit(tree);
  return result;
}

/** 为每类资源生成文档内稳定 token，并记录只落在单一原文位置的替换。 */
function collect_resource_replacements(
  tree: MarkdownNode,
  text: string,
): { replacements: TextReplacement[]; resources: ReadonlyMap<string, string> } {
  const ordinals: Record<ResourceKind, number> = { link: 0, image: 0, definition: 0 };
  const replacements: TextReplacement[] = [];
  const resources = new Map<string, string>();
  visit_nodes(tree, (node) => {
    if (!is_resource_node(node) || typeof node.url !== "string") {
      return;
    }
    const kind = node.type;
    const ordinal = ordinals[kind];
    ordinals[kind] += 1;
    const range = find_unique_text_range(text, node.position, node.url);
    if (range === null) {
      return;
    }
    const token = `${RESOURCE_TOKEN_PREFIX}${kind}/${ordinal.toString()}`;
    replacements.push({ ...range, replacement: token });
    resources.set(token, node.url);
  });
  return { replacements, resources };
}

function visit_nodes(node: MarkdownNode, visitor: (node: MarkdownNode) => void): void {
  visitor(node);
  for (const child of node.children ?? []) {
    visit_nodes(child, visitor);
  }
}

function contains_translatable_text(node: MarkdownNode): boolean {
  if (node.type === "text" && typeof node.value === "string" && node.value.trim() !== "") {
    return true;
  }
  if (node.type === "image" && typeof node.alt === "string" && node.alt.trim() !== "") {
    return true;
  }
  return (node.children ?? []).some(contains_translatable_text);
}

function is_resource_node(node: MarkdownNode): node is MarkdownNode & { type: ResourceKind } {
  return RESOURCE_KINDS.has(node.type as ResourceKind);
}

/** 只接受节点原文中的唯一 destination，避免同值标签与 URL 之间的猜测替换。 */
function find_unique_text_range(
  text: string,
  position: Position | undefined,
  target: string,
): Pick<TextReplacement, "start_offset" | "end_offset"> | null {
  if (!has_offset_position(position) || target === "") {
    return null;
  }
  const start_offset = position.start.offset;
  const node_text = text.slice(start_offset, position.end.offset);
  const local_start = node_text.indexOf(target);
  if (local_start < 0 || node_text.indexOf(target, local_start + target.length) >= 0) {
    return null;
  }
  return {
    start_offset: start_offset + local_start,
    end_offset: start_offset + local_start + target.length,
  };
}

/** 从后向前应用 offset 替换，确保前面的原始坐标不被后续文本长度影响。 */
function apply_replacements(text: string, replacements: TextReplacement[]): string {
  let result = text;
  for (const replacement of [...replacements].sort(
    (left, right) => right.start_offset - left.start_offset,
  )) {
    result =
      result.slice(0, replacement.start_offset) +
      replacement.replacement +
      result.slice(replacement.end_offset);
  }
  return result;
}

function has_offset_position(position: Position | undefined): position is Position & {
  start: Position["start"] & { offset: number };
  end: Position["end"] & { offset: number };
} {
  return typeof position?.start.offset === "number" && typeof position.end.offset === "number";
}

function compare_node_position(left: MarkdownNode, right: MarkdownNode): number {
  return (left.position?.start.offset ?? 0) - (right.position?.start.offset ?? 0);
}
