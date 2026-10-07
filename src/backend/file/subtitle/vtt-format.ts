import type { Item } from "../../../domain/item";
import { decode_text_content } from "../../../shared/utils/text-tool";
import { normalize_text_line_breaks } from "../../../shared/text/text-lines";
import type { FileFormatServiceConfig } from "../file-format-shared";
import {
  bind_subtitle_items,
  create_subtitle_items,
  needs_bilingual_text,
  read_subtitle_lines,
  read_subtitle_target,
  subtitle_error,
  type SubtitleOutput,
  type SubtitleSlot,
} from "./subtitle-text";

const VTT_TIMESTAMP = "(?:\\d{2,}:)?\\d{2}:\\d{2}\\.\\d{3}";
const VTT_TIMING_PATTERN = new RegExp(
  `^(${VTT_TIMESTAMP})[ \\t]+-->[ \\t]+(${VTT_TIMESTAMP})(?:[ \\t]+(.*))?$`,
  "u",
);
const VTT_INLINE_TIME_PATTERN = new RegExp(`^<${VTT_TIMESTAMP}>$`, "u");
const VTT_TAG_PATTERN = /^<(\/?)(b|i|u|c|v|lang|ruby|rt)((?:\.[^\s.<>]+)*)(?:[ \t]+([^<>]*))?>$/u;
const VTT_SPACE_TAGS = new Set(["v", "lang"]);
const VTT_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": "\u00a0",
  "&lrm;": "\u200e",
  "&rlm;": "\u200f",
};

type VTTText = SubtitleSlot & { kind: "text" };
type VTTTag = {
  kind: "tag";
  name: string;
  open: string; // 源开始标签，包含类名和标注
  close: string; // 源结束标签，空值表示合法省略
  children: VTTNode[];
};
type VTTNode = VTTText | VTTTag;
type VTTCue = {
  start: number; // 字幕块的源范围起点
  end: number; // 包含末行结束符的源范围终点
  row: number;
  header: string;
  ending: string;
  nodes: VTTNode[];
};
type VTTDocument = { cues: VTTCue[]; slots: SubtitleSlot[] };
type VTTBody = {
  source: string; // 保留控制标签的原文
  target: string; // 保留控制标签的目标正文
  source_text: string; // 双语判断使用的可见原文
  target_text: string; // 双语判断使用的可见目标正文
  changed: boolean; // 可见正文是否改写，决定注音与语言标注的处置
};

/** 解码 VTT 命名实体，未知实体继续作为正文。 */
function decode_vtt_text(text: string): string {
  return normalize_text_line_breaks(
    text.replace(/&(amp|lt|gt|nbsp|lrm|rlm);/gu, (entity) => VTT_ENTITIES[entity]!),
  );
}

/** 写入文本节点时转义控制字符，人工编辑沿用相同规则。 */
function escape_vtt_text(text: string): string {
  return text.replace(/[&<>\u00a0]/gu, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&nbsp;",
  );
}

/** 每个连续正文槽位独立翻译，使行内标签可作用于对应位置的译文。 */
export class VTTFormat {
  /** 固定当前双语和目标语言设置。 */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /** 从源资产提取正文槽位，格式结构在导出时由同一解析器重建。 */
  public async read_from_stream(content: Uint8Array, file: string): Promise<Item[]> {
    const text = await decode_text_content(content);
    return create_subtitle_items(text, this.parse_text(text, file).slots, file, "VTT");
  }

  /** 按源位置组装当前正文，单语和双语都先校验块边界。 */
  public render_text(text: string, items: readonly Item[], file: string): SubtitleOutput {
    const document = this.parse_text(text, file);
    const bound = bind_subtitle_items(document.slots, items, file);
    const default_ending = read_subtitle_lines(text).find((line) => line.ending)?.ending || "\n";
    let translated = "";
    let bilingual = "";
    let cursor = 0; // 已输出的源范围终点，块间内容只消费一次
    for (const cue of document.cues) {
      const before = text.slice(cursor, cue.start);
      translated += before;
      bilingual += before;
      const ending = cue.ending || default_ending;
      const bodies = this.render_payload(cue.nodes, bound, ending, false);
      const source_text = bodies.map((body) => body.source_text).join("");
      const target_text = bodies.map((body) => body.target_text).join("");
      // 原始空 cue 仍是文件结构；完成空正文只省略当前 cue。
      const keep_target = source_text.trim() === "" || target_text.trim() !== "";
      const source_body = bodies.map((body) => body.source).join("");
      const target_body = bodies.map((body) => body.target).join("");
      const combine = needs_bilingual_text(
        source_text,
        target_text,
        this.config.deduplication_in_bilingual,
      );
      let bilingual_body = source_body;
      if (combine) {
        // 两部分各自闭合作用域，省略的结束标签在双语连接处显式补齐。
        const closed = this.render_payload(cue.nodes, bound, ending, true);
        bilingual_body =
          closed.map((body) => body.source).join("") +
          ending +
          closed.map((body) => body.target).join("");
      }
      for (const body of [target_body, bilingual_body]) {
        if (
          normalize_text_line_breaks(body.trimEnd())
            .split("\n")
            .some((line) => line.trim() === "") &&
          body.trim() !== ""
        )
          throw subtitle_error(file, cue.row, "The subtitle text contains an empty cue line.");
      }
      if (keep_target) translated += cue.header + target_body + cue.ending;
      bilingual += cue.header + bilingual_body + cue.ending;
      cursor = cue.end;
    }
    return {
      translated: translated + text.slice(cursor),
      bilingual: bilingual + text.slice(cursor),
    };
  }

  /** 后序遍历同时生成两种正文，子节点的改写事实直接供父标签使用。 */
  private render_payload(
    nodes: readonly VTTNode[],
    items: ReadonlyMap<number, Item>,
    ending: string,
    close_spans: boolean,
  ): VTTBody[] {
    return nodes.map((node) => {
      if (node.kind === "text") {
        const target = read_subtitle_target(node, items);
        return {
          source: escape_vtt_text(node.text).replace(/\n/gu, ending),
          target: escape_vtt_text(target).replace(/\n/gu, ending),
          source_text: node.text,
          target_text: target,
          changed: target !== node.text,
        };
      }
      const children = this.render_payload(node.children, items, ending, close_spans);
      const changed = node.name !== "rt" && children.some((child) => child.changed);
      const close = node.close || (close_spans ? `</${node.name}>` : "");
      const source = node.open + children.map((child) => child.source).join("") + close;
      const target_children =
        node.name === "ruby" && changed
          ? children.filter((_, index) => {
              const child = node.children[index]!;
              return child.kind !== "tag" || child.name !== "rt";
            })
          : children;
      const target_body = target_children.map((child) => child.target).join("");
      const open =
        node.name === "lang" && changed
          ? node.open.replace(/[ \t]+[^>]+>$/u, ` ${this.config.target_language.toLowerCase()}>`)
          : node.open;
      return {
        source,
        target: node.name === "ruby" && changed ? target_body : open + target_body + close,
        source_text: node.name === "rt" ? "" : children.map((child) => child.source_text).join(""),
        target_text: node.name === "rt" ? "" : children.map((child) => child.target_text).join(""),
        changed,
      };
    });
  }

  /** 扫描字幕块，非正文块通过源范围切片保留。 */
  private parse_text(text: string, file: string): VTTDocument {
    const lines = read_subtitle_lines(text);
    if (!/^WEBVTT(?:[ \t].*)?$/u.test(lines[0]?.text ?? "") || lines[0]!.text.includes("-->"))
      throw subtitle_error(file, 0, "The WEBVTT header is missing or invalid.");
    let index = 1;
    while (index < lines.length && lines[index]!.text.trim() !== "") {
      if (lines[index]!.text.includes("-->"))
        throw subtitle_error(file, index, "The WEBVTT header must end with an empty line.");
      index++;
    }
    const cues: VTTCue[] = [];
    const slots: SubtitleSlot[] = [];
    while (index < lines.length) {
      if (lines[index]!.text.trim() === "") {
        index++;
        continue;
      }
      const start = index;
      while (index < lines.length && lines[index]!.text.trim() !== "") index++;
      const block = lines.slice(start, index);
      const first = block[0]!;
      if (/^NOTE(?:[ \t]|$)/u.test(first.text)) {
        if (block.some((line) => line.text.includes("-->")))
          throw subtitle_error(file, first.row, "The NOTE block contains a cue separator.");
        continue;
      }
      if (/^(?:STYLE|REGION)[ \t]*$/u.test(first.text)) {
        if (cues.length > 0 || block.some((line) => line.text.includes("-->")))
          throw subtitle_error(file, first.row, "The subtitle structure block is invalid.");
        continue;
      }
      const timing_index = first.text.includes("-->") ? 0 : 1;
      const timing = block[timing_index];
      const match = VTT_TIMING_PATTERN.exec(timing?.text ?? "");
      if (!timing || !match || match[3]?.includes("-->"))
        throw subtitle_error(file, first.row, "The subtitle time line is invalid.");
      const start_time = this.read_time(match[1]!, file, timing.row);
      const end_time = this.read_time(match[2]!, file, timing.row);
      if (end_time <= start_time)
        throw subtitle_error(file, timing.row, "The subtitle time range is invalid.");
      // 标识和时间只属于源结构，正文身份由源位置确定。
      const last = block.at(-1)!;
      const payload_start = timing.start + timing.text.length + timing.ending.length;
      const payload_end =
        timing_index + 1 === block.length ? payload_start : last.start + last.text.length;
      const nodes = this.parse_payload(
        text.slice(payload_start, payload_end),
        payload_start,
        file,
        timing.row,
      );
      const collect = (children: readonly VTTNode[]): void => {
        for (const node of children) {
          if (node.kind === "text") slots.push(node);
          else if (node.name !== "rt") collect(node.children);
        }
      };
      collect(nodes);
      cues.push({
        start: first.start,
        end: last.start + last.text.length + last.ending.length,
        row: first.row,
        header: text.slice(first.start, payload_start),
        nodes,
        ending: timing_index + 1 === block.length ? "" : last.ending,
      });
    }
    return { cues, slots };
  }

  /** 支持可选小时字段，校验分钟与秒的范围。 */
  private read_time(value: string, file: string, row: number): number {
    const parts = value.split(":").map(Number);
    const seconds = parts.pop()!;
    const minutes = parts.pop()!;
    if (seconds >= 60 || minutes >= 60)
      throw subtitle_error(file, row, "The subtitle timestamp is invalid.");
    return ((parts[0] ?? 0) * 60 + minutes) * 60 + seconds;
  }

  /** 控制标签形成结构节点，逐字时间移除后合并相邻正文。 */
  private parse_payload(payload: string, offset: number, file: string, row: number): VTTNode[] {
    if (payload.includes("-->"))
      throw subtitle_error(file, row, "The subtitle text contains a cue separator.");
    const root: VTTTag = { kind: "tag", name: "", open: "", close: "", children: [] };
    const stack = [root];
    let cursor = 0;
    let text_start = 0; // 当前正文片段的原始起点，移除时间标签时保持坐标
    let buffer = "";
    const flush = (): void => {
      if (buffer !== "")
        stack.at(-1)!.children.push({
          kind: "text",
          offset: offset + text_start,
          text: decode_vtt_text(buffer),
        });
      buffer = "";
    };
    for (const token of payload.matchAll(/<[^>\r\n]*>/gu)) {
      buffer += payload.slice(cursor, token.index);
      const raw = token[0];
      if (VTT_INLINE_TIME_PATTERN.test(raw)) {
        this.read_time(raw.slice(1, -1), file, row);
      } else {
        const tag = VTT_TAG_PATTERN.exec(raw);
        if (!tag) {
          buffer += raw;
          cursor = token.index + raw.length;
          continue;
        }
        flush();
        const name = tag[2]!;
        if (tag[1] === "/") {
          // `rt` 在 `ruby` 结束或下一个 `rt` 开始时允许省略结束标签。
          if (stack.at(-1)!.name === "rt" && name === "ruby") stack.pop();
          if (
            stack.length === 1 ||
            stack.at(-1)!.name !== name ||
            tag[3] !== "" ||
            tag[4] !== undefined
          )
            throw subtitle_error(file, row, "The subtitle closing tag is invalid.");
          stack.pop()!.close = raw;
        } else {
          if (VTT_SPACE_TAGS.has(name) !== Boolean(tag[4]?.trim()))
            throw subtitle_error(file, row, "The subtitle tag annotation is invalid.");
          if (name === "rt" && stack.at(-1)!.name === "rt") stack.pop();
          if (name === "rt" && stack.at(-1)!.name !== "ruby")
            throw subtitle_error(file, row, "The ruby annotation has no ruby text.");
          const node: VTTTag = { kind: "tag", name, open: raw, close: "", children: [] };
          stack.at(-1)!.children.push(node);
          stack.push(node);
        }
        text_start = token.index + raw.length;
      }
      cursor = token.index + raw.length;
    }
    buffer += payload.slice(cursor);
    flush();
    // 覆盖余下正文的说话人标注可以省略 `v` 结束标签。
    if (stack.slice(1).some((node) => node.name !== "v"))
      throw subtitle_error(file, row, "The subtitle tag is not closed.");
    return root.children;
  }
}
