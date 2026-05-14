import type { ApiJsonValue } from "../../api/api-types";

/** JSON record 是 Engine 协议跨线程、跨 API 边界的可变载荷最小公约数 */
export type JsonRecord = Record<string, ApiJsonValue>;

/** MutableJsonRecord 表达数据库和运行态 patch 仍会组装新对象，但不允许携带非 JSON 引用 */
export type MutableJsonRecord = Record<string, ApiJsonValue>;
