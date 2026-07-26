/**
 * JsonValue 是跨 main / renderer / worker 传递结构化载荷时的最小公共形状
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JsonRecord 用于边界快照，调用方必须按值复制，不能共享可变领域对象
 */
export type JsonRecord = Record<string, JsonValue>;

/**
 * MutableJsonRecord 只表示当前构建中的 JSON 字典，离开构建函数后仍按普通值对象流通
 */
export type MutableJsonRecord = Record<string, JsonValue>;

/**
 * 只收窄 JSON 对象的顶层形状；字段值合法性由具体边界继续校验。
 */
export function is_json_record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 弱类型载荷不是普通对象时返回空记录，让调用方安全读取可选字段。
 */
export function read_json_record(value: unknown): JsonRecord {
  return is_json_record(value) ? value : {};
}
