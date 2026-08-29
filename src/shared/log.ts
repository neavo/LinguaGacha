import type { LogError } from "./error/log-error";

const LOG_LEVELS = ["debug", "info", "warning", "error", "fatal"] as const; // 日志等级同时进入 main 日志、SSE payload 和日志窗口筛选

export const LOG_WINDOW_EVENT_CAPACITY = 8 * 1024; // main replay、详情池与 renderer 日志窗口共享同一实时保留上限

export const LOG_WINDOW_MESSAGE_PREVIEW_LENGTH = 1024; // 日志列表只消费预览，完整正文按需从后端详情池读取

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogTargets {
  file: boolean; // 写入日志文件
  console: boolean; // 输出到控制台
  window: boolean; // 推送到日志窗口和 SSE 订阅者
}

export interface LogEvent {
  id: string; // 单条日志事件 ID
  sequence: number; // 进程内递增序号
  created_at: string; // ISO 时间戳
  level: LogLevel; // 公开日志等级
  source: string; // 产生日志的模块或任务源
  message_preview: string; // 已格式化日志正文预览，供列表、筛选和 SSE 使用
  message_length: number; // 完整正文字符数，供 UI 判断详情体量
}

/** 模型响应的可选过程段，标题已按任务启动语言冻结。 */
export type LogTextSection = {
  title: string; // 思考过程、规则分析或原始响应等稳定标题
  text: string; // 保留换行的完整段落正文
};

/** 翻译结果的一组原文、译文与可选角色名。 */
export type LogTranslationPair = {
  src: string; // 单行原文
  dst: string; // 与原文对齐的单行译文
  actor_src?: string | null; // 字段存在表示角色模式，null 表示该行没有角色名
  actor_dst?: string | null; // 字段存在表示角色模式，null 表示该行没有译名
};

/** 分析结果中的单条术语映射。 */
export type LogAnalysisTerm = {
  src: string; // 原术语
  dst: string; // 目标术语
  info: string; // 可为空的补充说明
};

/** 日志正文的跨进程判别联合；文件、控制台和列表只消费它的纯文本投影。 */
export type LogContent =
  | {
      kind: "text";
      text: string; // 普通生命周期或诊断正文
    }
  | {
      kind: "translation_result";
      summary: string[]; // 统计、状态和重试摘要
      sections: LogTextSection[]; // 模型响应过程
      pairs: LogTranslationPair[]; // 按输入顺序排列的翻译对照
    }
  | {
      kind: "analysis_result";
      summary: string[]; // 统计与状态摘要
      sections: LogTextSection[]; // 模型响应过程
      src_title: string; // 分析输入标题
      srcs: string[]; // 实际送入分析的文本
      result_title: string; // 分析结果标题
      empty_result_text: string; // terms 为空时的任务语言文案
      terms: LogAnalysisTerm[]; // 有效术语结果
    };

export interface LogDetail {
  id: string; // 与 LogEvent.id 一一对应
  sequence: number; // 与轻量事件共享的进程内序号
  created_at: string; // 与轻量事件共享的创建时间
  level: LogLevel; // 与轻量事件共享的日志等级
  source: string; // 产生日志的模块或任务源
  content: LogContent; // 完整结构化正文，只通过详情接口按需读取
  error?: LogError; // Error 的可序列化边界快照
  context?: Record<string, unknown>; // 额外结构化上下文
}

export interface LogAppendPayload {
  level: LogLevel; // 写入等级
  content: LogContent; // 单一日志正文事实，输出目标按需投影为纯文本
  source?: string; // 产生日志的模块或任务源
  error?: unknown; // 进程内可传原始 Error，跨边界只传 LogError 快照
  context?: Record<string, unknown>; // 额外结构化上下文
  targets?: Partial<LogTargets>; // 单次写入的输出目标覆盖
}

export type LogSubscriber = (event: LogEvent) => void;

const LOG_LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);

// 边界反序列化先用判定函数收窄，避免未知日志等级进入 UI 筛选
function is_log_level(value: unknown): value is LogLevel {
  return LOG_LEVEL_SET.has(value as LogLevel);
}

// 旧配置或外部 payload 的未知日志等级统一降级为 info
export function normalize_log_level(value: unknown): LogLevel {
  return is_log_level(value) ? value : "info";
}

/**
 * HTTP 详情边界只接收当前判别联合，不读取旧 message 载荷。
 */
export function read_log_content(value: unknown): LogContent | null {
  const content = read_record(value);
  if (content === null) {
    return null;
  }

  switch (content["kind"]) {
    case "text":
      return typeof content["text"] === "string" ? { kind: "text", text: content["text"] } : null;
    case "translation_result": {
      const summary = read_string_array(content["summary"]);
      const sections = read_text_sections(content["sections"]);
      const pairs = read_translation_pairs(content["pairs"]);
      return summary === null || sections === null || pairs === null
        ? null
        : { kind: "translation_result", summary, sections, pairs };
    }
    case "analysis_result": {
      const summary = read_string_array(content["summary"]);
      const sections = read_text_sections(content["sections"]);
      const srcs = read_string_array(content["srcs"]);
      const terms = read_analysis_terms(content["terms"]);
      if (
        summary === null ||
        sections === null ||
        srcs === null ||
        terms === null ||
        typeof content["src_title"] !== "string" ||
        typeof content["result_title"] !== "string" ||
        typeof content["empty_result_text"] !== "string"
      ) {
        return null;
      }
      return {
        kind: "analysis_result",
        summary,
        sections,
        src_title: content["src_title"],
        srcs,
        result_title: content["result_title"],
        empty_result_text: content["empty_result_text"],
        terms,
      };
    }
    default:
      return null;
  }
}

/**
 * 文件、控制台与列表预览共用同一纯文本投影，结构化内容本身仍是详情池唯一事实。
 */
export function format_log_content_text(content: LogContent): string {
  if (content.kind === "text") {
    return content.text;
  }

  const rows = [
    ...content.summary,
    ...content.sections.map((section) => `${section.title}\n${section.text}`),
  ];
  if (content.kind === "translation_result") {
    const pair_lines: string[] = [];
    content.pairs.forEach((pair, index) => {
      pair_lines.push(`[${String(index + 1)}]`);
      pair_lines.push(`SRC: ${pair.src}`);
      if (Object.hasOwn(pair, "actor_src")) {
        pair_lines.push(`ACTOR_SRC: ${pair.actor_src ?? "null"}`);
      }
      pair_lines.push(`DST: ${pair.dst}`);
      if (Object.hasOwn(pair, "actor_dst")) {
        pair_lines.push(`ACTOR_DST: ${pair.actor_dst ?? "null"}`);
      }
    });
    if (pair_lines.length > 0) {
      rows.push(pair_lines.join("\n"));
    }
  } else {
    if (content.srcs.length > 0) {
      rows.push(`${content.src_title}\n${content.srcs.map((text) => `SRC: ${text}`).join("\n")}`);
    }
    const term_lines = content.terms.map((term) => {
      return term.info === ""
        ? `TERM: ${term.src} -> ${term.dst}`
        : `TERM: ${term.src} -> ${term.dst} #${term.info}`;
    });
    rows.push(
      `${content.result_title}\n${
        term_lines.length > 0 ? term_lines.join("\n") : content.empty_result_text
      }`,
    );
  }

  return `${rows.filter((row) => row.trim() !== "").join("\n\n")}\n`;
}

// 普通文本附带异常消息；结构化结果由 summary 承载用户文案，只追加诊断调用栈。
export function format_log_readable_text(detail: Pick<LogDetail, "content" | "error">): string {
  const error_message = detail.content.kind === "text" ? detail.error?.message : undefined;
  return [format_log_content_text(detail.content), error_message, detail.error?.stack]
    .filter((value): value is string => value !== undefined && value.trim() !== "")
    .join("\n");
}

/** 将未知边界值收窄为非数组对象。 */
function read_record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 严格读取字符串数组并复制，避免把传输对象引用交给调用方。 */
function read_string_array(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;
}

/** 严格读取模型响应过程段。 */
function read_text_sections(value: unknown): LogTextSection[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const sections: LogTextSection[] = [];
  for (const item of value) {
    const section = read_record(item);
    if (
      section === null ||
      typeof section["title"] !== "string" ||
      typeof section["text"] !== "string"
    ) {
      return null;
    }
    sections.push({ title: section["title"], text: section["text"] });
  }
  return sections;
}

/** 严格读取翻译对照；角色字段缺失与显式 null 保持不同语义。 */
function read_translation_pairs(value: unknown): LogTranslationPair[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const pairs: LogTranslationPair[] = [];
  for (const item of value) {
    const pair = read_record(item);
    if (pair === null || typeof pair["src"] !== "string" || typeof pair["dst"] !== "string") {
      return null;
    }
    const actor_src = pair["actor_src"];
    const actor_dst = pair["actor_dst"];
    if (
      (actor_src !== undefined && actor_src !== null && typeof actor_src !== "string") ||
      (actor_dst !== undefined && actor_dst !== null && typeof actor_dst !== "string")
    ) {
      return null;
    }
    pairs.push({
      src: pair["src"],
      dst: pair["dst"],
      ...(actor_src === undefined ? {} : { actor_src }),
      ...(actor_dst === undefined ? {} : { actor_dst }),
    });
  }
  return pairs;
}

/** 严格读取分析术语列表。 */
function read_analysis_terms(value: unknown): LogAnalysisTerm[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const terms: LogAnalysisTerm[] = [];
  for (const item of value) {
    const term = read_record(item);
    if (
      term === null ||
      typeof term["src"] !== "string" ||
      typeof term["dst"] !== "string" ||
      typeof term["info"] !== "string"
    ) {
      return null;
    }
    terms.push({ src: term["src"], dst: term["dst"], info: term["info"] });
  }
  return terms;
}
