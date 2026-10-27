import { create_item, type Item } from "../../../domain/item";
import type { JsonValue } from "../../../domain/json";
import type { SourceFileParseWarning } from "../file-format-types";
import { rpgmaker_default_status } from "./item";
import { read_javascript_strings, SOURCE_CONTEXT_MAX_LENGTH } from "../shared/javascript";
import {
  type JsonPath,
  type RPGMakerLocation,
  type RPGMakerMetadata,
  type RPGMakerRootLocation,
} from "./types";

type JsonMember = readonly [string | number, JsonValue];
type NearbyMembers = { members: readonly JsonMember[]; index: number };
const NEIGHBOR_CONTEXT_MIN_LENGTH = 64; // 为相邻成员预留短摘要，长目标优先使用其余预算。

/** 普通入口完整保存字符串，结构化入口解码 JSON 容器后逐个叶子调用普通入口。 */
export function create_rpgmaker_extractor(rel_path: string) {
  const items: Item[] = [];
  const warnings: SourceFileParseWarning[] = [];
  let extraction_complete = true;

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
    const context = metadata.source_context ?? JSON.stringify(metadata.location);
    /** 递归解码文本容器，保留叶子在原稿中的完整写回位置。 */
    function visit(text: string, location: RPGMakerLocation, nearby?: NearbyMembers): void {
      const decoded = parse_json_container(text);
      if (decoded === null) {
        add(text, {
          ...metadata,
          location,
          ...(nearby === undefined
            ? {}
            : { source_context: read_json_context(context, location, nearby) }),
        });
        return;
      }
      /** 插件 JSON 按普通结构遍历，避免将事件形状的对象当作引擎指令。 */
      function walk(value: JsonValue, target: JsonPath, nearby?: NearbyMembers): void {
        if (typeof value === "string") {
          visit(value, { kind: "json", container: location, path: target }, nearby);
        } else if (value !== null && typeof value === "object") {
          // 每个容器只枚举一次，叶子直接引用相邻成员，避免反复扫描父对象。
          const members: JsonMember[] = Array.isArray(value)
            ? value.map((entry, index) => [index, entry])
            : Object.entries(value);
          members.forEach(([key, entry], index) =>
            walk(entry, [...target, key], { members, index }),
          );
        }
      }
      walk(decoded, []);
    }
    visit(src, metadata.location);
  }

  /** 脚本偏移相对完整容器保存，语法失败时只保留诊断。 */
  function script(src: string, container: RPGMakerRootLocation): void {
    const result = read_javascript_strings(src);
    if (!result.ok) {
      extraction_complete = false;
      warnings.push({
        code: "script_syntax_error",
        rel_path,
        ...(container.kind === "field" && container.path.length === 0
          ? {}
          : {
              json_path:
                container.kind === "block"
                  ? [...container.path, container.start, "parameters", 0]
                  : container.path,
            }),
        diagnostics: result.diagnostics,
      });
      return;
    }
    for (const span of result.strings)
      (span.complete ? expand : add)(span.src, {
        usage: "metadata",
        source_context: span.source_context,
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
    get extraction_complete() {
      return extraction_complete;
    },
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

/** 先保证定位和目标，剩余预算只展示前后各一个成员。 */
function read_json_context(
  context: string,
  location: RPGMakerLocation,
  { members, index }: NearbyMembers,
): string {
  const paths: JsonPath[] = []; // 上下文与写回共用定位，避免维护另一份解码路径。
  for (let current = location; current.kind === "json"; current = current.container)
    paths.unshift(current.path);
  const location_budget = Math.floor(SOURCE_CONTEXT_MAX_LENGTH / 2);
  const path = excerpt(
    `JSON ${paths.map((target) => JSON.stringify(target)).join(" → ")}`,
    location_budget,
  );
  const outer = excerpt(context, location_budget - path.length - 1);
  const lines = outer ? [outer, path] : [path];
  const neighbors = [members[index - 1], members[index + 1]].filter((entry) => entry !== undefined);
  let remaining = SOURCE_CONTEXT_MAX_LENGTH - lines.join("\n").length;
  const target = summarize_member(
    members[index]!,
    remaining - 1 - neighbors.length * (NEIGHBOR_CONTEXT_MIN_LENGTH + 1),
  );
  lines.push(target);
  remaining -= target.length + 1;
  neighbors.forEach((member, index) => {
    const summary = summarize_member(
      member,
      Math.floor(remaining / (neighbors.length - index)) - 1,
    );
    lines.push(summary);
    remaining -= summary.length + 1;
  });
  return lines.join("\n");
}

/** 邻近对象只展示形状，字符串先截断再转义以限制摘要成本。 */
function summarize_member([key, value]: JsonMember, limit: number): string {
  const label = `${JSON.stringify(key)}: `;
  const budget = Math.max(0, limit - label.length);
  const summary =
    typeof value === "string"
      ? JSON.stringify(excerpt(value, budget))
      : Array.isArray(value)
        ? `Array(${value.length})`
        : value !== null && typeof value === "object"
          ? `Object(${Object.keys(value).length})`
          : String(value);
  return excerpt(label + summary, limit);
}

/** 截断不拆开 UTF-16 代理对，省略号也计入预算。 */
function excerpt(value: string, limit: number): string {
  if (limit <= 0) return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`;
}
