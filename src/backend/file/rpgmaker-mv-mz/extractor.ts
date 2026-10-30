import { create_item, type Item } from "../../../domain/item";
import type { JsonValue } from "../../../domain/json";
import type { SourceFileParseWarning } from "../file-format-types";
import { rpgmaker_default_status } from "./item";
import { read_javascript_strings } from "../shared/javascript";
import {
  type JsonPath,
  type RPGMakerLocation,
  type RPGMakerMetadata,
  type RPGMakerRootLocation,
} from "./types";

/** 普通入口完整保存字符串，结构化入口解码 JSON 容器后逐个叶子调用普通入口。 */
export function create_rpgmaker_extractor(rel_path: string) {
  const items: Item[] = [];
  const warnings: SourceFileParseWarning[] = [];

  /** 事件正文、选项、默认翻译字段和模板片段按原文保存，空对白仍可携带姓名。 */
  function add(
    src: string,
    metadata: Omit<RPGMakerMetadata, "internal_file_path">,
    name_src: string | null = null,
  ): void {
    if (src === "" && !name_src) return;
    const extra_field = { rpgmaker_mv_mz: { internal_file_path: rel_path, ...metadata } };
    items.push(
      create_item({
        src,
        name_src,
        file_path: rel_path,
        file_type: "RPGMAKER_MV_MZ",
        row: items.length,
        status: rpgmaker_default_status({ extra_field }),
        extra_field,
      }),
    );
  }

  /** 元数据与完整脚本字符串可能嵌套 JSON，每次解码增加一级定位，叶子沿用外层用途。 */
  function expand(src: string, metadata: Omit<RPGMakerMetadata, "internal_file_path">): void {
    /** 递归解码文本容器，保留叶子在原稿中的完整写回位置。 */
    function visit(text: string, location: RPGMakerLocation): void {
      const decoded = parse_json_container(text);
      if (decoded === null) {
        add(text, { ...metadata, location });
        return;
      }
      /** 插件 JSON 按普通结构遍历，避免将事件形状的对象当作引擎指令。 */
      function walk(value: JsonValue, target: JsonPath): void {
        if (typeof value === "string") {
          visit(value, { kind: "json", container: location, path: target });
        } else if (value !== null && typeof value === "object") {
          const members = Array.isArray(value) ? value.entries() : Object.entries(value);
          for (const [key, entry] of members) walk(entry, [...target, key]);
        }
      }
      walk(decoded, []);
    }
    visit(src, metadata.location);
  }

  /** 字段脚本的字符串偏移相对完整字段保存，解析失败时记录诊断。 */
  function script(src: string, container: Extract<RPGMakerRootLocation, { kind: "field" }>): void {
    const result = read_javascript_strings(src);
    if (!result.ok) {
      warnings.push({
        code: "script_syntax_error",
        rel_path,
        ...(container.path.length === 0 ? {} : { json_path: container.path }),
        diagnostics: result.diagnostics,
      });
      return;
    }
    for (const span of result.strings)
      (span.complete ? expand : add)(span.src, {
        usage: "metadata",
        location: {
          kind: "script",
          container,
          start: span.start,
          end: span.end,
          template: span.template,
        },
      });
  }
  return {
    items,
    warnings,
    add,
    expand,
    script,
  };
}

/** 标量和解析失败均是普通文本，只有对象与数组形成解码边界。 */
function parse_json_container(source: string): JsonValue[] | { [key: string]: JsonValue } | null {
  const text = source.trimStart();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    const value: JsonValue = JSON.parse(text);
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null; // 普通文本碰巧以括号开头时仍按原文提取。
  }
}
