import type { LocaleKey, TextResolver } from "./i18n";

export type SourceFileParseFailureRecord = {
  source_path: string; // source_path 保留真实源路径，日志和调试需要定位原文件
  rel_path: string; // rel_path 是工程或工作台内的目标相对路径，无法确定时为空串
  filename: string; // filename 是 Toast 可见定位，不把完整路径塞进页面提示
  code: string; // code 保留稳定错误码，方便日志和测试按语义断言
  message_key: LocaleKey; // message_key 让前端和日志按当前语言解析用户可见原因
};

/**
 * 收窄后端返回的失败文件列表，避免页面直接信任 API 动态载荷。
 */
export function normalize_source_file_parse_failures(
  value: unknown,
): SourceFileParseFailureRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const failure = normalize_source_file_parse_failure(item);
    return failure === null ? [] : [failure];
  });
}

/**
 * 生成 Toast 与日志共用的逐文件失败明细；列表不截断，保持用户能直接定位全部文件。
 */
export function format_source_file_parse_failure_notice(args: {
  failures: SourceFileParseFailureRecord[];
  text: TextResolver;
}): string {
  return args.failures
    .map((failure) => {
      return `${failure.filename} - ${args.text(failure.message_key)}`;
    })
    .join("\n");
}

/**
 * 单条失败记录必须同时有文件名和错误码，缺失字段说明协议载荷不可展示。
 */
function normalize_source_file_parse_failure(value: unknown): SourceFileParseFailureRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const filename = String(record["filename"] ?? "").trim();
  const code = String(record["code"] ?? "").trim();
  const source_path = String(record["source_path"] ?? "").trim();
  const rel_path = String(record["rel_path"] ?? "").trim();
  const message_key = String(record["message_key"] ?? `app.error.${code}.message`).trim();
  if (filename === "" || code === "" || message_key === "") {
    return null;
  }
  return {
    source_path,
    rel_path,
    filename,
    code,
    message_key: message_key as LocaleKey,
  };
}
