import iconv from "iconv-lite";

/** 测试自有协议夹具；压缩块刻意只含 literal，独立于生产压缩器。 */
function wolf_uint(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
}
/** 生成带长度和零终止符的测试字符串。 */
function wolf_string(text: string, utf8 = true): Buffer {
  const bytes = iconv.encode(text, utf8 ? "utf8" : "cp932");
  return Buffer.concat([wolf_uint(bytes.length + 1), bytes, Buffer.from([0])]);
}
/** 用纯 literal 生成独立于生产压缩器的 LZ4 参照块。 */
export function wolf_literal(input: Buffer): Buffer {
  const bytes = [Math.min(15, input.length) << 4];
  if (input.length >= 15) {
    let length = input.length - 15;
    while (length >= 255) {
      bytes.push(255);
      length -= 255;
    }
    bytes.push(length);
  }
  return Buffer.concat([Buffer.from(bytes), input]);
}
/** 按文件布局选择原始正文或带长度的压缩正文。 */
function packed(header: Buffer, body: Buffer, compress: boolean): Buffer {
  if (!compress) return Buffer.concat([header, body]);
  const content = wolf_literal(body);
  return Buffer.concat([header, wolf_uint(body.length), wolf_uint(content.length), content]);
}
/** 构造数据库与事件共用的数据头，编码标记由夹具参数决定。 */
function header(version: number, utf8: boolean, common = false): Buffer {
  return Buffer.from([
    0,
    0x57,
    0,
    0,
    0x4f,
    0x4c,
    utf8 ? 0x55 : 0,
    0x46,
    common ? 0x43 : 0x4d,
    0,
    version,
  ]);
}
/** 构造指令参数与版本附加区，供位置和用途测试复用。 */
export function wolf_command(
  code = 101,
  strings = ["原文"],
  integers: number[] = [],
  extended = false,
  utf8 = true,
): Buffer {
  return Buffer.concat([
    Buffer.from([integers.length + 1]),
    wolf_uint(code),
    ...integers.map(wolf_uint),
    Buffer.from([0, strings.length]),
    ...strings.map((s) => wolf_string(s, utf8)),
    Buffer.from(extended ? [0, 3, 9, 8, 7] : [0]),
  ]);
}
/** 事件 ID 刻意不同于物理索引，并保留尾部未知区域。 */
export function wolf_common(version = 0x91, commands?: Buffer[], utf8 = true): Buffer {
  const extended = version === 0x93 || version === 0xcc;
  const body = Buffer.concat([
    wolf_uint(1),
    Buffer.from([0x8e]),
    wolf_uint(99),
    Buffer.alloc(11),
    wolf_string("事件名", utf8),
    wolf_uint(commands?.length ?? 1),
    ...(commands ?? [wolf_command(101, ["原文"], [], extended, utf8)]),
    wolf_string("注释", utf8),
    wolf_string(""),
    Buffer.from([0x8f]),
    wolf_uint(0),
    wolf_uint(0),
    wolf_uint(0),
    wolf_uint(0),
    Buffer.alloc(29),
    ...Array.from({ length: 100 }, () => wolf_string("")),
    Buffer.from([0x91]),
    wolf_string(""),
    Buffer.from([0x92]),
    wolf_string("尾部", utf8),
    wolf_uint(42),
    Buffer.from([0x92, 0x89]),
  ]);
  return packed(header(version, utf8, true), body, extended);
}
/** 地图包含页面资源、重复正文与版本附加区。 */
export function wolf_map(version = 0x65, utf8 = true): Buffer {
  const prefix = Buffer.concat([
    Buffer.alloc(10),
    Buffer.from("WOLFM"),
    Buffer.from([0, utf8 ? 0x55 : 0, 0, 0, 0]),
    wolf_uint(version),
    Buffer.from([0]),
  ]);
  const body = Buffer.concat([
    wolf_string("地图", utf8),
    wolf_uint(0),
    wolf_uint(1),
    wolf_uint(1),
    wolf_uint(1),
    ...(version >= 0x67 ? [wolf_uint(0), wolf_uint(4)] : []),
    ...(utf8 ? [wolf_uint(0xffffffff)] : [Buffer.alloc((version >= 0x67 ? 4 : 3) * 4, 0xff)]),
    Buffer.from([0x6f]),
    wolf_uint(12345),
    wolf_uint(77),
    wolf_string("事件", utf8),
    Buffer.alloc(8),
    wolf_uint(1),
    wolf_uint(0),
    Buffer.from([0x79]),
    wolf_uint(0),
    wolf_string("Picture/日本.png", utf8),
    Buffer.alloc(47),
    wolf_uint(1),
    Buffer.from([0, 1]),
    wolf_uint(7),
    Buffer.from([1, 0]),
    wolf_uint(2),
    wolf_command(101, ["重复"], [], version >= 0x67, utf8),
    wolf_command(101, ["重复"], [], version >= 0x67, utf8),
    wolf_uint(4),
    Buffer.from([9, 8, 7, 6, 0x7a, 0x70, 0x66]),
  ]);
  return packed(prefix, body, version >= 0x65);
}
/** 数据库描述可声明资源别名，数据按物理字符串槽位存放。 */
export function wolf_database(
  version = 0xc3,
  utf8 = true,
  alias = false,
): { data: Buffer; project: Buffer } {
  const project = Buffer.concat([
    wolf_uint(1),
    wolf_string("地图登记", utf8),
    wolf_uint(2),
    wolf_string("路径", utf8),
    wolf_string("显示名称", utf8),
    wolf_uint(1),
    wolf_string("记录", utf8),
    wolf_string("说明", utf8),
    wolf_uint(2),
    Buffer.from([1, 0]),
    wolf_uint(0),
    wolf_uint(0),
    wolf_uint(0),
    wolf_uint(0),
  ]);
  const body = Buffer.concat([
    wolf_uint(1),
    wolf_uint(0xfffffffe),
    wolf_uint(0),
    wolf_uint(2),
    wolf_uint(2000),
    wolf_uint(alias ? 2000 : 2001),
    wolf_uint(1),
    wolf_string("MapData/Map001.mps", utf8),
    wolf_string("城镇", utf8),
    Buffer.from([version]),
  ]);
  return { project, data: packed(header(version, utf8), body, version === 0xc4) };
}
/** 构造各字符串数量分支及随写回变化的内部偏移。 */
export function wolf_game(count = 14, utf8 = true): Buffer {
  const parts = [
    Buffer.from([0, 0x57, 0, 0, 0x4f, 0x4c, 0, 0x46, 0x4d, utf8 ? 0x55 : 0]),
    wolf_uint(3),
    Buffer.from([12, 34, 56]),
    wolf_uint(count),
  ];
  const strings = [
    "主标题",
    "0000-0000",
    "",
    "字体",
    "副字体",
    "",
    "",
    "Chara/a.png",
    "副标题",
    "Picture/load.png",
    "Picture/gauge.png",
    "启动文字",
    "标题提示",
    "未知区域",
  ];
  for (let i = 0; i < count; i++)
    parts.push(
      i === 2
        ? Buffer.concat([wolf_uint(3), Buffer.from([1, 2, 3])])
        : wolf_string(strings[i]!, utf8),
    );
  const body = Buffer.concat(parts),
    length = body.length + 26;
  return Buffer.concat([
    body,
    wolf_uint(length - 1),
    wolf_uint(0),
    wolf_uint(1),
    Buffer.from([99, 88]),
    wolf_uint(length - 4),
    wolf_uint(length - 2),
    Buffer.from([0xfa, 0xce, 0xba, 0xbe]),
  ]);
}
/** 图块夹具保留资源字段及不参与翻译的属性字节。 */
export function wolf_tileset(version = 0xd3, utf8 = true): Buffer {
  return Buffer.concat([
    header(version, utf8),
    wolf_uint(1),
    ...Array.from({ length: 33 }, (_, i) =>
      wolf_string(i === 0 ? "图块" : "MapChip/日本.png", utf8),
    ),
    Buffer.from([0xff]),
    wolf_uint(2),
    Buffer.from([1, 2, 0xff]),
    wolf_uint(2),
    Buffer.from([7, 6, 5, 4, 3, 2, 1, 0, 0xcf]),
  ]);
}
/** 组成带核心配对、登记地图与未登记地图的完整游戏原稿。 */
export function wolf_files(): Map<string, Buffer> {
  const database = wolf_database();
  return new Map([
    ["Data/BasicData/Game.dat", wolf_game()],
    ["Data/BasicData/SysDatabase.dat", database.data],
    ["Data/BasicData/SysDatabase.project", database.project],
    ["Data/BasicData/CommonEvent.dat", wolf_common()],
    ["Data/BasicData/TileSetData.dat", wolf_tileset()],
    ["Data/BasicData/Auxiliary.dat", Buffer.from([7, 6, 5])],
    ["Data/MapData/Map001.mps", wolf_map()],
    ["Data/MapData/Unregistered.mps", wolf_map(0x64)],
  ]);
}
