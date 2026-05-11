/**
 * Database workflow 载荷只允许可被严格 JSON 序列化的值。
 */
export type DatabaseJsonValue =
  | null
  | boolean
  | number
  | string
  | DatabaseJsonValue[]
  | { [key: string]: DatabaseJsonValue };

/**
 * ProjectDatabase 的窄操作描述，由上层领域服务构造并在数据库层集中校验。
 */
export interface DatabaseOperation {
  // 操作名由 服务层固定发出，database 层集中分发和校验。
  name: string;
  // args 必须保持值对象形状，避免调用方跨层共享可变数据库对象。
  args?: Record<string, DatabaseJsonValue>;
}
