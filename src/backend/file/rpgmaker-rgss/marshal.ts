import assert from "node:assert/strict";
const MAX_MARSHAL_DEPTH = 512;
const OBJECT_TAGS = new Set('"/[{}ofluUSdcmM'); // Ruby 对象表中的类型，包装和符号拥有独立语义。

export type MarshalPair = [MarshalNode, MarshalNode];
/** 节点保持 Marshal 标签与对象身份，包装节点由 owner 维护首次引用时的编码信息。 */
export interface MarshalNode {
  t: string;
  data?: Buffer;
  value?: number;
  flag?: number;
  sign?: number;
  items?: MarshalNode[];
  pairs?: MarshalPair[];
  klass?: MarshalNode;
  child?: MarshalNode;
  target?: MarshalNode;
  default?: MarshalNode;
  owner?: MarshalNode;
}
/** 引用与类型包装不改变底层对象身份。 */
export function base(node: MarshalNode): MarshalNode {
  const seen = new Set<MarshalNode>();
  while (["@", ";", "I", "e", "C"].includes(node.t)) {
    assert(!seen.has(node), "Cyclic Marshal wrapper");
    seen.add(node);
    const next = node.target ?? node.child;
    assert(next, "Invalid Marshal wrapper");
    node = next;
  }
  return node;
}
/** 成员名只接受 Ruby Symbol，避免把 Hash 的普通键混入对象访问。 */
export function symbol(node: MarshalNode): string {
  const value = base(node);
  assert(value.t === ":", "Expected Marshal symbol");
  return value.data!.toString("utf8");
}
/** 对象与 Struct 使用符号成员，其他容器由各自的访问规则处理。 */
export function field(node: MarshalNode, key: string): MarshalNode | undefined {
  const value = base(node);
  if (value.t !== "o" && value.t !== "S") return undefined;
  return value.pairs!.find(([k]) => symbol(k) === key)?.[1];
}
/** 引用上的额外包装不能取代对象首次声明的 owner，否则克隆字符串会沿 owner 回到自身。 */
function assign_wrapper_owner(wrapper: MarshalNode): void {
  let child = wrapper.child!;
  while (["I", "e", "C"].includes(child.t)) child = child.child!;
  if (child.t !== "@" && child.t !== ";") child.owner = wrapper;
}

/** 校验 Marshal 4.8 字节边界并保留引用身份，返回原生对象图。 */
export function decode(input: Uint8Array): MarshalNode {
  const b = Buffer.from(input);
  let p = 2;
  const objects: MarshalNode[] = [],
    symbols: MarshalNode[] = [];
  let depth = 0;
  assert.equal(b[0], 4);
  assert.equal(b[1], 8);
  // 统一检查游标，所有标签、长度及引用编号都从此读取。
  function byte() {
    assert(p < b.length, "truncated byte");
    return b[p++]!;
  }
  // Marshal 紧凑整数的首字节区分短值和带符号的后续字节数。
  function int() {
    let n = byte();
    if (n > 127) n -= 256;
    if (!n) return 0;
    if (n > 4) return n - 5;
    if (n < -4) return n + 5;
    let v = n < 0 ? -1 : 0;
    for (let i = 0; i < Math.abs(n); i++) v = (v & ~(255 << (8 * i))) | (byte() << (8 * i));
    return v;
  }
  // 长度先验证再切片，截断载荷不能进入类型节点。
  function chunk() {
    const n = int();
    assert(n >= 0 && p + n <= b.length, "invalid length");
    const v = b.subarray(p, p + n);
    p += n;
    return v;
  }
  // 对象成员和 Hash 项都保留原始键顺序。
  function pairs(): MarshalPair[] {
    const count = int();
    assert(count >= 0 && count <= b.length, "invalid pair count");
    return Array.from({ length: count }, () => [read(), read()]);
  }
  // 对象先注册再读子节点，使自引用能够指向尚未读完的对象。
  function read(): MarshalNode {
    assert(++depth <= MAX_MARSHAL_DEPTH, "Marshal nesting limit");
    const start = p;
    const t = String.fromCharCode(byte());
    const n: MarshalNode = { t };
    if (OBJECT_TAGS.has(t)) objects.push(n);
    switch (t) {
      case "0":
      case "T":
      case "F":
        break;
      case "i":
        n.value = int();
        break;
      case ":":
        n.data = chunk();
        symbols.push(n);
        break;
      case ";":
        n.target = symbols[int()]!;
        assert(n.target, "invalid symbol reference");
        break;
      case "@":
        n.target = objects[int()]!;
        assert(n.target, "invalid object reference");
        break;
      case '"':
      case "f":
      case "c":
      case "m":
      case "M":
        n.data = chunk();
        break;
      case "/":
        n.data = chunk();
        n.flag = byte();
        break;
      case "l": {
        n.sign = byte();
        const size = int() * 2;
        assert(size >= 0 && p + size <= b.length);
        n.data = b.subarray(p, p + size);
        p += size;
        break;
      }
      case "[": {
        const count = int();
        assert(count >= 0 && count <= b.length);
        n.items = Array.from({ length: count }, read);
        break;
      }
      case "{":
      case "}":
        n.pairs = pairs();
        if (t === "}") n.default = read();
        break;
      case "o":
      case "S":
        n.klass = read();
        n.pairs = pairs();
        break;
      case "u":
        n.klass = read();
        n.data = chunk();
        break;
      case "U":
      case "d":
        n.klass = read();
        n.child = read();
        break;
      case "C":
      case "e":
        n.klass = read();
        n.child = read();
        assign_wrapper_owner(n);
        break;
      case "I":
        n.child = read();
        n.pairs = pairs();
        assign_wrapper_owner(n);
        break;
      default:
        throw Error(`Unsupported Marshal tag ${t} at ${start}`);
    }
    depth--;
    return n;
  }
  const root = read();
  assert.equal(p, b.length, "trailing bytes");
  return root;
}
/** 按节点身份重建引用表，文本之外的原始载荷直接复用。 */
export function encode(root: MarshalNode): Buffer {
  const out: Buffer[] = [Buffer.from([4, 8])];
  const objects = new Map<MarshalNode, number>(),
    symbols = new Map<MarshalNode, number>();
  const wrappers = new Set<MarshalNode>();
  const byte = (n: number) => out.push(Buffer.from([n]));
  // 使用协议的最短整数表示，符号决定扩展终点。
  function int(n: number) {
    assert(Number.isSafeInteger(n) && n >= -2147483648 && n <= 2147483647);
    if (n === 0) {
      byte(0);
      return;
    }
    if (n > 0 && n < 123) {
      byte(n + 5);
      return;
    }
    if (n < 0 && n > -124) {
      byte(n - 5);
      return;
    }
    const bs = [];
    let v = n;
    do {
      bs.push(v & 255);
      v >>= 8;
    } while (v !== (n < 0 ? -1 : 0));
    byte(n < 0 ? -bs.length : bs.length);
    out.push(Buffer.from(bs));
  }
  // 字符串和不透明载荷都以原始字节长度写入。
  function chunk(b: Buffer) {
    int(b.length);
    out.push(b);
  }
  // 成员顺序决定后续引用编号，写出时沿用原顺序。
  function pairs(ps: MarshalPair[]) {
    int(ps.length);
    for (const [k, v] of ps) {
      write(k);
      write(v);
    }
  }
  // 已写对象输出引用，首次出现的包装恢复类信息和编码。
  function write(n: MarshalNode): void {
    if (["I", "e", "C"].includes(n.t)) {
      if (wrappers.has(n)) {
        const target = base(n);
        return write(target.t === ":" ? target : { t: "@", target });
      }
      wrappers.add(n);
    }
    if (n.t === ";") return write(n.target!);
    if (n.t === "@") {
      if (!objects.has(n.target!)) return write(n.target!.owner ?? n.target!);
      byte(64);
      int(objects.get(n.target!)!);
      return;
    }
    if (n.t === ":") {
      if (symbols.has(n)) {
        byte(59);
        int(symbols.get(n)!);
        return;
      }
      symbols.set(n, symbols.size);
      byte(58);
      chunk(n.data!);
      return;
    }
    if (OBJECT_TAGS.has(n.t)) {
      if (objects.has(n)) {
        byte(64);
        int(objects.get(n)!);
        return;
      }
      objects.set(n, objects.size);
    }
    byte(n.t.charCodeAt(0));
    switch (n.t) {
      case "0":
      case "T":
      case "F":
        break;
      case "i":
        int(n.value!);
        break;
      case '"':
      case "f":
      case "c":
      case "m":
      case "M":
        chunk(n.data!);
        break;
      case "/":
        chunk(n.data!);
        byte(n.flag!);
        break;
      case "l":
        byte(n.sign!);
        int(n.data!.length / 2);
        out.push(n.data!);
        break;
      case "[":
        int(n.items!.length);
        n.items!.forEach(write);
        break;
      case "{":
      case "}":
        pairs(n.pairs!);
        if (n.t === "}") write(n.default!);
        break;
      case "o":
      case "S":
        write(n.klass!);
        pairs(n.pairs!);
        break;
      case "u":
        write(n.klass!);
        chunk(n.data!);
        break;
      case "U":
      case "d":
      case "C":
      case "e":
        write(n.klass!);
        write(n.child!);
        break;
      case "I":
        write(n.child!);
        pairs(n.pairs!);
        break;
      default:
        throw Error("Unsupported write " + n.t);
    }
  }
  write(root);
  return Buffer.concat(out);
}
