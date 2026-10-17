import assert from "node:assert/strict";
import { open_wolf_document, WolfReader, type WolfDocument } from "./binary";

const MAGIC = [0, 0x57, 0, 0, 0x4f, 0x4c, 0, 0x46, 0x4d, 0];
const STRING_INDEX_BASE = 2000; // 字段索引从此值起指向字符串列。
const INTEGER_INDEX_BASE = 1000; // 字段索引从此值起指向整数列。
export type WolfDatabaseType = {
  name: string;
  fields: Array<{ name: string; type: number }>;
  names: string[];
  indexes: number[];
  strings: string[][];
};
export type WolfDatabase = Readonly<{
  data: WolfDocument;
  project: WolfDocument;
  types: readonly WolfDatabaseType[];
}>;

/** 描述文件映射到物理字符串槽位，字段别名共用一个写入目标。 */
export function read_wolf_database(project: Uint8Array, input: Uint8Array): WolfDatabase {
  const doc = open_wolf_document(input, MAGIC, 6, 10, [0xc2, 0xc3, 0xc4], [0xc4], 11);
  const p = new WolfReader(Buffer.from(project), 0, doc.utf8),
    reader = new WolfReader(doc.bytes, 11, doc.utf8);
  const types: WolfDatabaseType[] = [];
  for (let n = p.count(), type = 0; type < n; type++) {
    const name = p.string({ kind: "database_type", type }),
      fields: WolfDatabaseType["fields"] = [];
    for (let m = p.count(), field = 0; field < m; field++)
      fields.push({ name: p.string({ kind: "database_field", type, field }), type: 0 });
    const names: string[] = [];
    for (let m = p.count(), record = 0; record < m; record++)
      names.push(p.string({ kind: "database_record", type, record }));
    p.string();
    const meta = p.count();
    assert(meta >= fields.length, "Invalid WOLF database field metadata");
    for (const field of fields) field.type = p.byte();
    p.take(meta - fields.length);
    for (let m = p.count(); m; m--) p.string();
    for (let m = p.count(); m; m--) for (let count = p.count(); count; count--) p.string();
    for (let m = p.count(); m; m--) p.take(p.count() * 4);
    p.take(p.count() * 4);
    types.push({ name, fields, names, indexes: [], strings: [] });
  }
  p.done();
  assert.equal(reader.count(), types.length, "WOLF database companion type count mismatch");
  for (let type = 0; type < types.length; type++) {
    const entry = types[type]!;
    assert.equal(reader.uint(), 0xfffffffe);
    const kind = reader.uint(),
      count = reader.count();
    assert(count <= entry.fields.length, "WOLF database companion field count mismatch");
    if (kind === 120000) reader.string();
    for (let i = 0; i < count; i++) entry.indexes.push(reader.uint());
    const records = reader.count();
    assert(records <= entry.names.length, "WOLF database companion record count mismatch");
    const integers = entry.indexes.filter((index) => index < STRING_INDEX_BASE).length,
      strings = count - integers;
    assert(
      entry.indexes.every((index) =>
        index >= STRING_INDEX_BASE
          ? index - STRING_INDEX_BASE < strings
          : index >= INTEGER_INDEX_BASE && index - INTEGER_INDEX_BASE < integers,
      ),
      "Invalid WOLF database physical index",
    );
    // 字段到物理槽位的映射属于类型，所有记录共用，避免逐条重新扫描字段。
    const string_fields: WolfDatabaseType["fields"][] = Array.from({ length: strings }, () => []);
    entry.indexes.forEach((index, field) => {
      if (index >= STRING_INDEX_BASE)
        string_fields[index - STRING_INDEX_BASE]!.push(entry.fields[field]!);
    });
    for (let record = 0; record < records; record++) {
      reader.take(integers * 4);
      const values: string[] = [];
      for (let string = 0; string < strings; string++) {
        const fields = string_fields[string]!;
        // 任一别名是资源或未知类型时，该物理槽位默认保护。
        const usage =
          fields.length && fields.every((field) => field.type === 0) ? "text" : "metadata";
        values.push(
          reader.string(
            { kind: "database_string", type, record, string },
            usage,
            [entry.name, entry.names[record], ...fields.map((field) => field.name)].join(" / "),
          ),
        );
      }
      entry.strings.push(values);
    }
  }
  reader.expect(doc.bytes[10]!);
  reader.done();
  doc.slots = reader.slots;
  doc.details = { types };
  return {
    data: doc,
    project: {
      original: project,
      bytes: p.bytes,
      utf8: doc.utf8,
      compression: null,
      slots: p.slots,
      details: { types: types.map(({ name, fields, names }) => ({ name, fields, names })) },
    },
    types,
  };
}

/** 系统数据库第零类型、第零字段是地图登记路径，字段索引仍映射到物理槽位。 */
export function read_wolf_map_registry(database: WolfDatabase): ReadonlySet<string> {
  const maps = database.types[0],
    index = maps?.indexes[0];
  assert(
    maps && index !== undefined && index >= STRING_INDEX_BASE,
    "Missing WOLF system map registry",
  );
  return new Set(
    maps.strings
      .map((strings) => strings[index - STRING_INDEX_BASE]!)
      .filter(Boolean)
      .map((name) => "data/" + name.replaceAll("\\", "/").toLowerCase()),
  );
}
