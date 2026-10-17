import assert from "node:assert/strict";

const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]); // TrueType、Apple `true` 与 CFF `OTTO`。
const FAMILY_NAME_ID = 1;
const WINDOWS_PLATFORM_ID = 3;
const ENGLISH_LANGUAGE_ID = 0x0409; // 英文族名为 ASCII，不受系统语言与游戏编码影响。

/** Windows 平台各语言的族名是同一字体的别名，英文族名排在最前。 */
export function read_font_family_names(bytes: Uint8Array): string[] {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(data.length >= 12 && SFNT_VERSIONS.has(data.readUInt32BE(0)), "Unsupported font file");
  const tables = data.readUInt16BE(4);
  assert(12 + tables * 16 <= data.length, "Truncated font table directory");
  let name_at = -1;
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16;
    if (data.toString("latin1", record, record + 4) === "name")
      name_at = data.readUInt32BE(record + 8);
  }
  assert(name_at >= 0 && name_at + 6 <= data.length, "Font file has no name table");
  const count = data.readUInt16BE(name_at + 2),
    strings = name_at + data.readUInt16BE(name_at + 4);
  assert(name_at + 6 + count * 12 <= data.length, "Truncated font name table");
  const english: string[] = [],
    others: string[] = [];
  for (let index = 0; index < count; index++) {
    const record = name_at + 6 + index * 12;
    // 只有 Windows 平台的族名参与 GDI 匹配。
    if (
      data.readUInt16BE(record) !== WINDOWS_PLATFORM_ID ||
      data.readUInt16BE(record + 6) !== FAMILY_NAME_ID
    )
      continue;
    const start = strings + data.readUInt16BE(record + 10),
      end = start + data.readUInt16BE(record + 8);
    assert(end <= data.length && (end - start) % 2 === 0, "Invalid font name record");
    const text = Buffer.from(data.subarray(start, end)).swap16().toString("utf16le").trim(); // 名称为 UTF-16BE。
    if (!text) continue;
    (data.readUInt16BE(record + 4) === ENGLISH_LANGUAGE_ID ? english : others).push(text);
  }
  const names = [...new Set([...english, ...others])];
  assert(names.length, "Font file has no family name");
  return names;
}
