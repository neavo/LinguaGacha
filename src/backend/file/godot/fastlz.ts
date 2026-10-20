/*! @license
fastlz
https://github.com/godotengine/godot/blob/master/thirdparty/misc/fastlz.c
FastLZ - Byte-aligned LZ77 compression library
  Copyright (C) 2005-2020 Ariya Hidayat <ariya.hidayat@gmail.com>

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
*/
import assert from "node:assert/strict";
import { GODOT_RESOURCE_MAX_BYTES } from "./binary";
/** FastLZ 的重叠回引用须逐字节展开，输出长度由资源块协议给定。 */
export function fastlz_decode(src: Buffer, size: number): Buffer {
  assert(size >= 0 && size <= GODOT_RESOURCE_MAX_BYTES);
  if (!size) {
    assert(!src.length);
    return Buffer.alloc(0);
  }
  assert(src.length > 0);
  const level = (src[0]! >>> 5) + 1;
  assert(level === 1 || level === 2);
  const out = Buffer.alloc(size);
  let at = 1,
    pos = 0,
    control = src[0]! & 31;
  const byte = () => {
    assert(at < src.length, "Truncated FastLZ");
    return src[at++]!;
  };
  while (true) {
    if (control >= 32) {
      let length = (control >>> 5) - 1;
      const distance = (control & 31) << 8;
      if (length === 6) {
        let code: number;
        do {
          code = byte();
          length += code;
        } while (level === 2 && code === 255);
      }
      const low = byte();
      let ref = pos - distance - 1 - low;
      length += 3;
      if (level === 2 && low === 255 && distance === 31 << 8)
        ref = pos - ((byte() << 8) + byte()) - 8192;
      assert(ref >= 0 && pos + length <= size);
      for (let i = 0; i < length; i++) out[pos++] = out[ref++]!;
    } else {
      const length = control + 1;
      assert(at + length <= src.length && pos + length <= size);
      src.copy(out, pos, at, at + length);
      at += length;
      pos += length;
    }
    if (at === src.length) break;
    control = byte();
  }
  assert.equal(pos, size);
  return out;
}
