/**
 * Database workflow 载荷只允许可被严格 JSON 序列化的值
 */
export type DatabaseJsonValue =
  | null
  | boolean
  | number
  | string
  | DatabaseJsonValue[]
  | { [key: string]: DatabaseJsonValue };
