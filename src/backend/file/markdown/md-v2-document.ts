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
  src: string; // 当前块原文
  rule_skipped: boolean; // 当前块是否由 Markdown 结构规则跳过翻译
};

export type MarkdownV2Document = {
  units: MarkdownV2Unit[]; // 按原文顺序排列且互不重叠的写回单元
};

type MarkdownNode = Node & {
  type: string;
  children?: MarkdownNode[];
  value?: unknown;
  alt?: unknown;
};

// 容器只提供 Markdown 骨架，规则跳过节点决定块是否进入翻译。
const STRUCTURAL_CONTAINER_KINDS = new Set(["root", "list", "listItem", "blockquote"]);
const RULE_SKIPPED_KINDS = new Set(["code", "html", "thematicBreak", "definition", "yaml", "toml"]);
// 单例 processor 固定 Markdown 方言，所有解析入口共享同一语法配置。
const MARKDOWN_PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"]);

/**
 * 把 Markdown 解析为互不重叠的块单元，并保留块内原始文本。
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
          rule_skipped: true,
        },
      ],
    };
  }

  const units: MarkdownV2Unit[] = [];
  let cursor = 0;
  for (const node of nodes) {
    const position = node.position as Position;
    const start_offset = position.start.offset as number;
    const end_offset = position.end.offset as number;
    units.push({
      kind: node.type,
      start_offset,
      end_offset,
      start_line: position.start.line - 1,
      end_line: position.end.line - 1,
      start_column: position.start.column - 1,
      before: text.slice(cursor, start_offset),
      after: "",
      src: text.slice(start_offset, end_offset),
      rule_skipped: RULE_SKIPPED_KINDS.has(node.type) || !contains_translatable_text(node),
    });
    cursor = end_offset;
  }
  const last_unit = units.at(-1) as MarkdownV2Unit;
  last_unit.after = text.slice(cursor);
  return { units };
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

/** 文本节点和图片 alt 是 Markdown 块可翻译正文的来源。 */
function contains_translatable_text(node: MarkdownNode): boolean {
  if (node.type === "text" && typeof node.value === "string" && node.value.trim() !== "") {
    return true;
  }
  if (node.type === "image" && typeof node.alt === "string" && node.alt.trim() !== "") {
    return true;
  }
  return (node.children ?? []).some(contains_translatable_text);
}

/** 只接受拥有完整 offset 的节点，保证块范围可以无损切回原文。 */
function has_offset_position(position: Position | undefined): position is Position & {
  start: Position["start"] & { offset: number };
  end: Position["end"] & { offset: number };
} {
  return typeof position?.start.offset === "number" && typeof position.end.offset === "number";
}

/** 按源文 offset 排序原子块。 */
function compare_node_position(left: MarkdownNode, right: MarkdownNode): number {
  return (left.position?.start.offset ?? 0) - (right.position?.start.offset ?? 0);
}
