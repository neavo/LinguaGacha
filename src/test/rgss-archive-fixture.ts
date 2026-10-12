/** 测试自有封包器：用独立的 BigInt 运算生成标准 v1/v3 协议。 */
export function rgss_archive_fixture(
  version: 1 | 3,
  files: ReadonlyMap<string, Uint8Array>,
): Buffer {
  const integer = (value: number | bigint): Buffer => {
    // 写入协议规定的 32 位小端字段。
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(Number(BigInt(value) & 0xffffffffn));
    return bytes;
  };
  const advance = (key: bigint): bigint => (key * 7n + 3n) & 0xffffffffn; // 显式截断溢出位。
  // 成员数据每四字节推进密钥，目录字段使用各自版本的编码规则。
  const encrypt = (content: Uint8Array, initial: bigint): Buffer => {
    let key = initial;
    return Buffer.from(
      content.map((byte, index) => {
        const result = byte ^ Number((key >> BigInt((index % 4) * 8)) & 255n);
        if (index % 4 === 3) key = advance(key);
        return result;
      }),
    );
  };
  const header = Buffer.from([82, 71, 83, 83, 65, 68, 0, version]);
  if (version === 1) {
    let key = 0xdeadcafen;
    const chunks: Buffer[] = [header];
    for (const [name, content] of files) {
      const filename = Buffer.from(name);
      chunks.push(integer(BigInt(filename.length) ^ key));
      key = advance(key);
      chunks.push(
        Buffer.from(
          filename.map((byte) => {
            const result = byte ^ Number(key & 255n);
            key = advance(key);
            return result;
          }),
        ),
      );
      chunks.push(integer(BigInt(content.length) ^ key));
      key = advance(key);
      chunks.push(encrypt(content, key));
    }
    return Buffer.concat(chunks);
  }
  const key = 42n * 9n + 3n;
  const member_key = 0x12345678n;
  let offset =
    12 + [...files.keys()].reduce((total, name) => total + 16 + Buffer.byteLength(name), 16);
  const table = [header, integer(42)];
  const contents: Buffer[] = [];
  for (const [name, content] of files) {
    const filename = Buffer.from(name);
    table.push(
      ...[BigInt(offset), BigInt(content.length), member_key, BigInt(filename.length)].map(
        (value) => integer(value ^ key),
      ),
    );
    table.push(
      Buffer.from(
        filename.map((byte, index) => byte ^ Number((key >> BigInt((index % 4) * 8)) & 255n)),
      ),
    );
    contents.push(encrypt(content, member_key));
    offset += content.length;
  }
  table.push(...Array.from({ length: 4 }, () => integer(key)));
  return Buffer.concat([...table, ...contents]);
}
