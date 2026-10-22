import assert from "node:assert/strict";
import path from "node:path";
import type { JsonRecord, JsonValue } from "../../../domain/json";
import type { GameFiles } from "../shared/game/format";
import type { ReadableFile } from "../shared/game/readable";
import { base, decode, symbol, type MarshalNode } from "./marshal";
import { array, integer, text, read_text } from "./value";
import { read_rgss_script } from "./scripts";
import { read_rgss_game, RGSS_VERSIONS } from "./source";

const SCRIPT_INDEX_WIDTH = 4;

/** JSON Pointer 指向首次展开位置，数组、字符串也保留共享与循环身份。 */
export function read_rgss_json(root: MarshalNode): JsonValue {
  const seen = new Map<MarshalNode, string>(); // 按节点身份去重，相同文本仍可属于不同对象。
  /** 先登记对象再展开成员，引用返回已有位置。 */
  function read(node: MarshalNode, pointer: string): JsonValue {
    // nil、布尔值和紧凑整数不进入 Marshal 对象表。
    if (node.t === "0") return null;
    if (node.t === "T" || node.t === "F") return node.t === "T";
    if (node.t === "i") return node.value!;
    if (node.t === "@" || node.t === ";") {
      const target = node.target!; // 引用回到首次声明的包装，保留编码和附加字段。
      return read(target.owner && seen.has(target.owner) ? target.owner : target, pointer);
    }
    const previous = seen.get(node);
    if (previous !== undefined) return { $ref: previous };
    seen.set(node, pointer);
    // 标准字符串编码包装折叠为文本，额外实例变量仍按完整包装展示。
    if (
      node.t === '"' ||
      (node.t === "I" &&
        node.child!.t === '"' &&
        node.pairs!.every(([key]) => ["E", "encoding"].includes(symbol(key))))
    ) {
      seen.set(base(node), pointer);
      try {
        return text(node.owner ?? node);
      } catch (error) {
        return {
          $type: "string",
          $bytes: base(node).data!.toString("base64"),
          $error: reason(error),
        };
      }
    }
    if (node.t === "[")
      return node.items!.map((entry, index) => read(entry, `${pointer}/${index}`));
    if (node.t === "o" || node.t === "S")
      return {
        $class: symbol(node.klass!),
        ...(node.t === "S" ? { $type: "struct" } : {}),
        $fields: Object.fromEntries(
          node.pairs!.map(([key, entry]) => {
            const name = symbol(key);
            return [
              name,
              read(entry, `${pointer}/$fields/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`),
            ];
          }),
        ),
      };
    const result: JsonRecord = { $type: node.t }; // 特殊类型保留标签和载荷，供诊断读取。
    if (node.data) result.$bytes = node.data.toString("base64");
    if (node.data && [":", "f", "c", "m", "M"].includes(node.t)) {
      try {
        result.$value = read_text(node.data);
        delete result.$bytes;
      } catch (error) {
        result.$error = reason(error); // 非文本名称保留原字节及解码失败原因。
      }
    }
    if (node.flag !== undefined) result.$flag = node.flag;
    if (node.sign !== undefined) result.$sign = node.sign;
    if (node.klass) result.$class = symbol(node.klass);
    if (node.child) result.$value = read(node.child, `${pointer}/$value`);
    if (node.pairs)
      result.$entries = node.pairs.map(([key, entry], index) => [
        read(key, `${pointer}/$entries/${index}/0`),
        read(entry, `${pointer}/$entries/${index}/1`),
      ]);
    if (node.default) result.$default = read(node.default, `${pointer}/$default`);
    return result;
  }
  return read(root, "#");
}

/** 局部失败写入明文，保留解析器提供的原因。 */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 统一明文编码，换行便于按行读取与搜索。 */
function json_file(name: string, value: JsonValue): ReadableFile {
  return [name, Buffer.from(JSON.stringify(value, null, 2) + "\n")];
}

/** 脚本名称只进入清单，文件名由序号决定，保留源码本身的行号。 */
function* read_scripts(root: MarshalNode, name: string): Generator<ReadableFile> {
  const manifest: JsonRecord[] = [];
  for (const [index, node] of array(root).entries()) {
    const entry: JsonRecord = { index };
    manifest.push(entry);
    let source: string;
    try {
      const record = array(node);
      assert(record.length === 3, "Invalid RGSS script archive");
      entry.id = integer(record[0]!);
      entry.name = text(record[1]!);
      const script = read_rgss_script(record[2]!);
      entry.encoding = script.encoding;
      source = script.source;
    } catch (error) {
      entry.error = reason(error);
      continue;
    }
    const file = `${String(index).padStart(SCRIPT_INDEX_WIDTH, "0")}.rb`;
    entry.file = file;
    yield [`${name}/${file}`, Buffer.from(source)];
  }
  yield json_file(`${name}/scripts.json`, manifest);
}

/** 逐成员生成原稿明文，解析失败保留位置与原因。工作区 IO 由调用者处理。 */
export async function* read_rgss_sources(files: GameFiles): AsyncGenerator<ReadableFile> {
  let game: Awaited<ReturnType<typeof read_rgss_game>> | undefined;
  try {
    game = await read_rgss_game(files);
  } catch (error) {
    yield json_file("rgss.error.json", { file: "Game.ini", error: reason(error) });
  }
  if (game && ![...files.keys()].some((name) => name.toLowerCase() === game.scripts.toLowerCase()))
    yield json_file(`${game.scripts}.error.json`, {
      file: game.scripts,
      error: "Missing script archive",
    });
  for (const [name, member] of files) {
    const content = await member.async("uint8array");
    if (!game || path.extname(name).toLowerCase() !== RGSS_VERSIONS[game.version]) {
      yield [name, content];
      continue;
    }
    try {
      const root = decode(content);
      if (name.toLowerCase() === game.scripts.toLowerCase()) {
        yield* read_scripts(root, name);
      } else {
        yield json_file(`${name}.json`, read_rgss_json(root));
      }
    } catch (error) {
      yield json_file(`${name}.error.json`, { file: name, error: reason(error) });
      yield [name, content];
    }
  }
}
