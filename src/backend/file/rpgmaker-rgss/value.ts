import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { base, symbol, type MarshalNode } from "./marshal";

export type RubyPath = (number | { field: string } | { entry: number })[];
/** 数组访问先确认 Ruby 类型，调用方随后使用真实元素槽位。 */
export function array(node: MarshalNode): MarshalNode[] {
  const value = base(node);
  assert(value.t === "[", "Expected Ruby array");
  return value.items!;
}
/** 指令码和参数索引使用 Ruby 整数，其他数值类型不能代入。 */
export function integer(node: MarshalNode): number {
  const value = base(node);
  assert(value.t === "i", "Expected Ruby integer");
  return value.value!;
}
/** 取得字符串的原始字节，压缩脚本也通过该入口读取。 */
export function bytes(node: MarshalNode): Buffer {
  const value = base(node);
  assert(value.t === '"', "Expected Ruby string");
  return value.data!;
}
/** 显式编码优先，无标记的 RGSS 文本采用引擎标准 UTF-8 并严格验证。 */
export function read_text(data: Uint8Array, encoding = "utf8"): string {
  const buffer = Buffer.from(data);
  assert(iconv.encodingExists(encoding), `Unsupported encoding: ${encoding}`);
  const text = iconv.decode(buffer, encoding, { stripBOM: false });
  assert(iconv.encode(text, encoding).equals(buffer), `Invalid ${encoding} text`);
  return text;
}
/** 编码后反向核对译文，阻止编码器静默用问号替换字符。 */
export function write_text(text: string, encoding = "utf8"): Buffer {
  assert(iconv.encodingExists(encoding), `Unsupported encoding: ${encoding}`);
  const buffer = iconv.encode(text, encoding);
  assert(
    iconv.decode(buffer, encoding, { stripBOM: false }) === text,
    `Text cannot be encoded as ${encoding}`,
  );
  return buffer;
}
/** 引用沿首次声明读取编码，未声明时使用 RGSS 的 UTF-8 文本约定。 */
function encoding(node: MarshalNode): string {
  let current = node.t === "@" ? (node.target!.owner ?? node.target!) : node;
  while (["I", "e", "C"].includes(current.t)) {
    if (current.t === "I") {
      const named = current.pairs!.find(([key]) => symbol(key) === "encoding");
      if (named) return bytes(named[1]).toString("ascii");
    }
    current = current.child!;
  }
  return "utf8";
}
/** 同时消费字符串字节和编码包装，供原文与定位校验共用。 */
export function text(node: MarshalNode): string {
  return read_text(bytes(node), encoding(node));
}
/** 仅克隆目标字符串及其包装，原引用继续指向旧对象，实例变量仍保留。 */
export function replace_bytes(node: MarshalNode, data: Buffer, utf8 = false): MarshalNode {
  const original = node.t === "@" ? (node.target!.owner ?? node.target!) : node;
  if (["I", "e", "C"].includes(original.t)) {
    const child = replace_bytes(original.child!, data, utf8);
    const pairs = original.pairs?.map(([key, value]): [MarshalNode, MarshalNode] =>
      utf8 && symbol(key) === "E" ? [key, { t: "T" }] : [key, value],
    );
    const result = { ...original, child, ...(pairs ? { pairs } : {}) };
    delete result.owner;
    base(child).owner = result;
    return result;
  }
  bytes(original);
  const result = { ...original, data };
  delete result.owner;
  return result;
}
/** 先验证目标编码，再克隆字符串并更新 UTF-8 包装。 */
export function replace_text(node: MarshalNode, value: string): MarshalNode {
  const codec = encoding(node);
  return replace_bytes(node, write_text(value, codec), codec === "utf8");
}
/** 槽位身份由实际父节点与成员位置决定，字符串对象本身不决定翻译身份。 */
export type RubySlot = Readonly<{ parent: MarshalNode; index: number }>;
/** 已解析槽位直接访问父容器，路径别名共享同一值。 */
export function read_slot(slot: RubySlot): MarshalNode {
  return slot.parent.t === "["
    ? slot.parent.items![slot.index]!
    : slot.parent.pairs![slot.index]![1];
}
/** 修改计划通过校验后，从唯一槽位替换值。 */
export function write_slot(slot: RubySlot, value: MarshalNode): void {
  if (slot.parent.t === "[") slot.parent.items![slot.index] = value;
  else slot.parent.pairs![slot.index]![1] = value;
}
/** 同一原稿操作中的解析结果使用唯一槽位对象，路径别名可直接按身份归组。 */
export class RubySlots {
  private readonly slots = new Map<MarshalNode, Map<number, RubySlot>>();
  /** 每次原稿操作独立维护槽位身份，避免不同对象图共享缓存。 */
  public constructor(private readonly root: MarshalNode) {}
  /** 空路径表示原稿根对象，其余路径读取实际槽位。 */
  public read(path: RubyPath): MarshalNode {
    return path.length ? read_slot(this.resolve(path)) : this.root;
  }
  /** 按父节点与成员索引复用槽位，原稿中的别名由此收敛。 */
  public resolve(path: RubyPath): RubySlot {
    assert(path.length > 0, "Ruby root has no parent slot");
    let node = this.root,
      slot: RubySlot | undefined;
    for (const part of path) {
      const parent = base(node);
      let index: number;
      if (typeof part === "number") {
        assert(
          parent.t === "[" && Number.isInteger(part) && part >= 0 && part < parent.items!.length,
          "Invalid Ruby array slot",
        );
        index = part;
      } else if ("field" in part) {
        assert(parent.t === "o" || parent.t === "S", "Expected Ruby object member");
        index = parent.pairs!.findIndex(([key]) => symbol(key) === part.field);
        assert(index >= 0, "Invalid Ruby object member");
      } else {
        assert(
          (parent.t === "{" || parent.t === "}") &&
            Number.isInteger(part.entry) &&
            part.entry >= 0 &&
            part.entry < parent.pairs!.length,
          "Invalid Ruby Hash entry",
        );
        index = part.entry;
      }
      let members = this.slots.get(parent);
      if (!members) {
        members = new Map();
        this.slots.set(parent, members);
      }
      slot = members.get(index);
      if (!slot) {
        slot = { parent, index };
        members.set(index, slot);
      }
      node = read_slot(slot);
    }
    return slot!;
  }
}
