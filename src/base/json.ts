// JsonValue 是跨 main / renderer / worker 传递结构化载荷时的最小公共形状。
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// JsonRecord 用于边界快照，调用方必须按值复制，不能共享可变领域对象。
export type JsonRecord = Record<string, JsonValue>;

// MutableJsonRecord 只表示当前构建中的 JSON 字典，离开构建函数后仍按普通值对象流通。
export type MutableJsonRecord = Record<string, JsonValue>;
