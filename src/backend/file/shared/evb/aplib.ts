// aPLib 解码参考 Sandor Nemes 的纯 Python 实现（aplib 0.6，GPL-3.0）。
import assert from "node:assert/strict";
const MAX_OUTPUT = 64 * 1024 * 1024; // 单个压缩块的内存上限，成员总大小不受此值限制。
/** 读取压缩流时拒绝截断，不能把缺失字节解释为零。 */
function range(source: Buffer, offset: number, size: number): void {
  assert(offset >= 0 && offset + size <= source.length, "Truncated aPLib block");
}
/** EVB 按压缩块调用，校验回溯和声明输出长度。 */
export function decompress_aplib(source: Buffer, limit: number): Buffer {
  assert(limit >= 0 && limit <= MAX_OUTPUT, "Output limit");
  let output = Buffer.alloc(Math.min(limit, 4096));
  let input = 0,
    n = 0,
    tag = 0,
    bits = 0,
    last = 0,
    lwm = 0;
  // 字节游标与控制位游标共用同一个输入流。
  const byte = () => {
    range(source, input, 1);
    return source[input++]!;
  };
  const bit = () => {
    // 控制字节从最高位开始消费。
    if (bits === 0) {
      tag = byte();
      bits = 8;
    }
    const v = (tag >> 7) & 1;
    tag = (tag << 1) & 255;
    bits--;
    return v;
  };
  const gamma = () => {
    // Gamma 编码同时控制回溯偏移和长度。
    let v = 1;
    do {
      v = v * 2 + bit();
      assert(v <= MAX_OUTPUT, "Gamma limit");
    } while (bit());
    return v;
  };
  const put = (v: number) => {
    // 逐步扩容，避免按不可信的声明长度一次分配。
    assert(n < limit, "Output overrun");
    if (n === output.length) {
      const next = Buffer.alloc(Math.min(limit, Math.max(1, output.length * 2)));
      output.copy(next);
      output = next;
    }
    output[n++] = v;
  };
  const copy = (offset: number, length: number) => {
    // 逐字节回溯允许源和目标范围重叠。
    assert(offset > 0 && offset <= n && length <= limit - n, "Invalid backreference");
    for (let i = 0; i < length; i++) put(output[n - offset]!);
  };
  put(byte());
  while (true) {
    if (!bit()) {
      put(byte());
      lwm = 0;
      continue;
    }
    if (!bit()) {
      let offset = gamma();
      if (lwm === 0 && offset === 2) copy(last, gamma());
      else {
        offset = (offset - (lwm === 0 ? 3 : 2)) * 256 + byte();
        let length = gamma();
        if (offset >= 32000) length++;
        if (offset >= 1280) length++;
        if (offset < 128) length += 2;
        copy(offset, length);
        last = offset;
      }
      lwm = 1;
      continue;
    }
    if (!bit()) {
      let offset = byte();
      const length = 2 + (offset & 1);
      offset = Math.floor(offset / 2);
      if (offset === 0) break;
      copy(offset, length);
      last = offset;
      lwm = 1;
      continue;
    }
    let offset = 0;
    for (let i = 0; i < 4; i++) offset = offset * 2 + bit();
    if (offset) copy(offset, 1);
    else put(0);
    lwm = 0;
  }
  assert.equal(input, source.length, "Trailing compressed bytes");
  return output.subarray(0, n);
}
