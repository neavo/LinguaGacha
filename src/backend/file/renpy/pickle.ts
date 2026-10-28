import type { Edit } from "../shared/splice";
import { setImmediate } from "node:timers/promises";

export const PICKLE_MAX_BYTES = 64 * 1024 * 1024;
const MAX_OPERATIONS = 8_000_000;
const MAX_NODES = 5_000_000;
const COMPUTE_STEP = 50_000;
export type PickleNode = {
  kind:
    | "none"
    | "bool"
    | "number"
    | "integer"
    | "unicode"
    | "bytes"
    | "global"
    | "tuple"
    | "list"
    | "set"
    | "frozenset"
    | "dict"
    | "object"
    | "ref";
  value: null | boolean | number | bigint | string | Buffer;
  children: PickleNode[];
  start: number;
  end: number;
  memo_end?: number;
  target?: PickleNode;
  cls?: PickleNode;
  args?: PickleNode;
  state?: PickleNode;
};
export type PickleGraph = {
  root: PickleNode;
  nodes: PickleNode[];
  frames: { start: number; end: number }[];
};
/** 协议校验位于逐指令热路径，只在失败时构造错误；`node:assert` 的可变参数调用会逐次分配。 */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const UTF8 = new TextDecoder("utf-8", { fatal: true }); // 严格解码器无状态，热路径复用同一实例。

/** GLOBAL 与 REDUCE 只保存数据记录，永远不加载模块或执行构造器。 */
function* parse_pickle(input: Uint8Array): Generator<void, PickleGraph> {
  const data = Buffer.from(input);
  check(data.length <= PICKLE_MAX_BYTES, "Pickle exceeds size limit");
  let position = 0;
  const mark = Symbol("mark"),
    stack: (PickleNode | typeof mark)[] = [];
  const memo = new Map<number, PickleNode>(),
    nodes: PickleNode[] = [];
  const frames: { start: number; end: number }[] = [];
  let frame_end: number | undefined;
  // 定长读取直接按偏移取值，只有失败时才构造错误消息。
  const truncated = () => new Error("Truncated Pickle at " + position);
  const take = (length: number): Buffer => {
    if (!(Number.isSafeInteger(length) && length >= 0 && position + length <= data.length))
      throw truncated();
    const bytes = data.subarray(position, position + length);
    position += length;
    return bytes;
  };
  const byte = (): number => {
    if (position >= data.length) throw truncated();
    return data[position++]!;
  };
  const uint = (): number => {
    if (position + 4 > data.length) throw truncated();
    const value = data.readUInt32LE(position);
    position += 4;
    return value;
  };
  const line = () => {
    const end = data.indexOf(10, position);
    check(end >= position, "Unterminated Pickle line");
    return take(end - position + 1)
      .subarray(0, -1)
      .toString("utf8");
  };
  const pop = (): PickleNode => {
    const value = stack.pop();
    check(value !== undefined && value !== mark, "Invalid Pickle stack");
    return value;
  };
  const top = () => {
    const value = pop();
    stack.push(value);
    return value;
  };
  const marked = (): PickleNode[] => {
    const index = stack.lastIndexOf(mark);
    check(index >= 0, "Missing Pickle MARK");
    const values = stack.splice(index + 1) as PickleNode[];
    stack.pop();
    return values;
  };
  const push = (
    kind: PickleNode["kind"],
    value: PickleNode["value"],
    start: number,
    children: PickleNode[] = [],
  ): PickleNode => {
    check(nodes.length < MAX_NODES, "Pickle exceeds node limit");
    const node: PickleNode = { kind, value, start, end: position, children };
    nodes.push(node);
    stack.push(node);
    return node;
  };
  const append = (values: PickleNode[], kinds: PickleNode["kind"][]) => {
    const node = resolve_node(top());
    check(kinds.includes(node.kind), "Invalid Pickle container");
    if (node.kind === "dict") check(values.length % 2 === 0, "Invalid Pickle pairs");
    node.children.push(...values);
  };
  for (let count = 0; position < data.length; count++) {
    check(count < MAX_OPERATIONS, "Pickle exceeds operation limit");
    if (count > 0 && count % COMPUTE_STEP === 0) yield;
    if (frame_end === position) frame_end = undefined;
    const start = position,
      op = byte();
    switch (op) {
      case 0x80:
        check(byte() <= 5, "Unsupported Pickle protocol");
        break;
      case 0x95: {
        check(frame_end === undefined, "Nested Pickle FRAME");
        const length = Number(take(8).readBigUInt64LE());
        check(
          Number.isSafeInteger(length) && position + length <= data.length,
          "Invalid Pickle FRAME",
        );
        frames.push({ start, end: position });
        frame_end = position + length;
        break;
      }
      case 0x2e:
        check(stack.length === 1 && position === data.length, "Invalid Pickle STOP");
        check(frame_end === undefined || position === frame_end, "Truncated Pickle FRAME");
        return { root: pop(), nodes, frames };
      case 0x28:
        stack.push(mark);
        break;
      case 0x30:
        pop();
        break;
      case 0x4e:
        push("none", null, start);
        break;
      case 0x88:
      case 0x89:
        push("bool", op === 0x88, start);
        break;
      case 0x4b:
        push("number", byte(), start);
        break;
      case 0x4d:
        push("number", take(2).readUInt16LE(), start);
        break;
      case 0x4a:
        push("number", uint() | 0, start);
        break;
      case 0x47:
        push("number", take(8).readDoubleBE(), start);
        break;
      case 0x8a:
      case 0x8b: {
        const bytes = take(op === 0x8a ? byte() : uint());
        check(bytes.length <= 1024, "Pickle integer exceeds limit");
        let value = 0n;
        for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]!);
        if ((bytes.at(-1) ?? 0) & 128) value -= 1n << BigInt(bytes.length * 8);
        push("integer", value, start);
        break;
      }
      case 0x58:
      case 0x8c:
        push("unicode", UTF8.decode(take(op === 0x58 ? uint() : byte())), start);
        break;
      case 0x55:
      case 0x43:
        push("bytes", take(byte()), start);
        break;
      case 0x54:
      case 0x42:
        push("bytes", take(uint()), start);
        break;
      case 0x63: {
        const module = line(),
          name = line();
        push("global", module + "." + name, start);
        break;
      }
      case 0x93: {
        const name = node_string(pop()),
          module = node_string(pop());
        push("global", module + "." + name, start);
        break;
      }
      case 0x94:
      case 0x71:
      case 0x72: {
        const id = op === 0x94 ? memo.size : op === 0x71 ? byte() : uint();
        check(!memo.has(id), "Duplicate Pickle memo");
        const node = top();
        memo.set(id, node);
        node.memo_end = position;
        break;
      }
      case 0x68:
      case 0x6a: {
        const target = memo.get(op === 0x68 ? byte() : uint());
        check(target !== undefined, "Unknown Pickle reference");
        push("ref", null, start).target = target;
        break;
      }
      case 0x29:
        push("tuple", null, start);
        break;
      case 0x74:
        push("tuple", null, start, marked());
        break;
      case 0x85:
      case 0x86:
      case 0x87: {
        const values: PickleNode[] = [];
        for (let i = 0; i < op - 0x84; i++) values.unshift(pop());
        push("tuple", null, start, values);
        break;
      }
      case 0x5d:
        push("list", null, start);
        break;
      case 0x8f:
        push("set", null, start);
        break;
      case 0x90:
        append(marked(), ["set"]);
        break;
      case 0x91:
        push("frozenset", null, start, marked());
        break;
      case 0x6c:
        push("list", null, start, marked());
        break;
      case 0x61:
        append([pop()], ["list", "object"]);
        break;
      case 0x65:
        append(marked(), ["list", "object"]);
        break;
      case 0x7d:
        push("dict", null, start);
        break;
      case 0x64: {
        const values = marked();
        check(values.length % 2 === 0, "Invalid Pickle pairs");
        push("dict", null, start, values);
        break;
      }
      case 0x73: {
        const value = pop(),
          key = pop();
        append([key, value], ["dict", "object"]);
        break;
      }
      case 0x75: {
        const values = marked();
        check(values.length % 2 === 0, "Invalid Pickle pairs");
        append(values, ["dict", "object"]);
        break;
      }
      case 0x81:
      case 0x52: {
        const args = pop(),
          cls = pop(),
          node = push("object", null, start);
        node.cls = cls;
        node.args = args;
        break;
      }
      case 0x62: {
        const state = pop(),
          node = resolve_node(top());
        check(node.kind === "object", "Invalid Pickle BUILD");
        node.state = state;
        break;
      }
      default:
        throw new Error(`Unsupported Pickle opcode 0x${op.toString(16)} at ${start}`);
    }
    check(frame_end === undefined || position <= frame_end, "Pickle opcode crosses FRAME");
  }
  throw new Error("Missing Pickle STOP");
}
/** 解析在有界指令批次后让出，使取消消息能在大索引解析期间进入。 */
export async function read_pickle(input: Uint8Array, signal?: AbortSignal): Promise<PickleGraph> {
  const parser = parse_pickle(input);
  for (;;) {
    signal?.throwIfAborted();
    const result = parser.next();
    if (result.done) return result.value;
    await setImmediate();
  }
}

/** `GET` 只引用已存在的 memo 节点，纯引用链不会成环。容器回环由调用方按图遍历。 */
export function resolve_node(node: PickleNode): PickleNode {
  while (node.kind === "ref") node = node.target!;
  return node;
}
/** 协议字符串使用严格 UTF-8，旧界面显示字节由提取层单独解释。 */
export function node_string(node: PickleNode): string {
  const value = resolve_node(node).value;
  check(typeof value === "string" || Buffer.isBuffer(value), "Expected Pickle string");
  return typeof value === "string" ? value : UTF8.decode(value);
}
/** 类名来自序列化记录，读取过程不实例化该类。 */
export function class_name(node: PickleNode): string {
  node = resolve_node(node);
  return node.cls ? node_string(node.cls) : "";
}
const NO_ATTRIBUTES: ReadonlyMap<string, PickleNode> = new Map(); // 标量与无状态节点共用，避免逐节点分配。
/** BUILD 可同时保存普通属性与 slots 属性，两者合成字段视图。 */
export function attributes(node: PickleNode): ReadonlyMap<string, PickleNode> {
  const state = resolve_node(node).state;
  if (!state) return NO_ATTRIBUTES;
  const result = new Map<string, PickleNode>();
  const resolved = resolve_node(state);
  const dictionaries = resolved.kind === "tuple" ? resolved.children.map(resolve_node) : [resolved];
  for (const dictionary of dictionaries)
    if (dictionary.kind === "dict")
      for (let i = 0; i < dictionary.children.length; i += 2)
        result.set(node_string(dictionary.children[i]!), dictionary.children[i + 1]!);
  return result;
}
/** 只移除已经验证的 FRAME 头，消费边坐标随后按无帧字节计算。 */
export function unframe_pickle(data: Buffer, frames: PickleGraph["frames"]): Buffer {
  if (frames.length === 0) return data; // 未分帧输入直接保留，避免复制整个脚本。
  const pieces: Buffer[] = [];
  let cursor = 0;
  for (const frame of frames) {
    pieces.push(data.subarray(cursor, frame.start));
    cursor = frame.end;
  }
  pieces.push(data.subarray(cursor));
  return Buffer.concat(pieces);
}
/** 写回统一使用 BINUNICODE，使新旧引擎都按 Unicode 读取译文。 */
export function pickle_string(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8"),
    header = Buffer.alloc(5);
  header[0] = 0x58;
  header.writeUInt32LE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}
/** 将消费边转换为原稿区间，memo 原值继续供其他引用使用。 */
export function edge_edit(edge: PickleNode, bytes: Buffer): Edit {
  if (edge.kind !== "ref" && edge.memo_end !== undefined)
    return {
      start: edge.memo_end,
      end: edge.memo_end,
      bytes: Buffer.concat([Buffer.from([0x30]), bytes]), // POP 丢弃当前消费值，再压入新值。
    };
  return { start: edge.start, end: edge.end, bytes };
}
