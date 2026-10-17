/** 只含 `name` 表的最小 SFNT 字体，记录按 UTF-16BE 写入。 */
export function font_fixture(
  names: ReadonlyArray<
    Readonly<{ text: string; platform?: number; name_id?: number; language?: number }>
  >,
): Buffer {
  const strings = names.map(({ text }) => Buffer.from(text, "utf16le").swap16());
  const records = Buffer.alloc(names.length * 12);
  let offset = 0;
  names.forEach(({ platform = 3, name_id = 1, language = 0x0409 }, index) => {
    const record = index * 12;
    records.writeUInt16BE(platform, record);
    records.writeUInt16BE(1, record + 2); // Unicode BMP 编码。
    records.writeUInt16BE(language, record + 4);
    records.writeUInt16BE(name_id, record + 6);
    records.writeUInt16BE(strings[index]!.length, record + 8);
    records.writeUInt16BE(offset, record + 10);
    offset += strings[index]!.length;
  });
  const header = Buffer.alloc(6);
  header.writeUInt16BE(names.length, 2);
  header.writeUInt16BE(6 + records.length, 4);
  const table = Buffer.concat([header, records, ...strings]);
  const directory = Buffer.alloc(28);
  directory.writeUInt32BE(0x00010000); // TrueType 版本号。
  directory.writeUInt16BE(1, 4);
  directory.write("name", 12, "latin1");
  directory.writeUInt32BE(directory.length, 20);
  directory.writeUInt32BE(table.length, 24);
  return Buffer.concat([directory, table]);
}
