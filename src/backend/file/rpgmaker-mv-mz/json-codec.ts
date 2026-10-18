import type { JsonValue } from "../../../domain/json";

// Electron 已支持这些原生接口，项目的 ES2025 类型库尚未声明它们。
const json_with_source = JSON as unknown as {
  parse(
    source: string,
    reviver: (
      this: object,
      key: string,
      value: JsonValue,
      context: { source?: string },
    ) => JsonValue,
  ): JsonValue;
  rawJSON(source: string): object;
};

/** 数值原始表示属于资产事实，每次导出独占原稿记录，普通对象与数值继续供事件和路径逻辑使用。 */
export class RPGMakerJsonCodec {
  private readonly numbers = new WeakMap<object, Map<string, { value: number; source: string }>>();

  /** 数值原稿绑定所属对象和字段，事件对象移动后仍可追溯。 */
  public parse(source: string): JsonValue {
    const numbers = this.numbers;
    return json_with_source.parse(source, function (key, value, context) {
      if (typeof value === "number") {
        let fields = numbers.get(this);
        if (!fields) {
          fields = new Map();
          numbers.set(this, fields);
        }
        fields.set(key, { value, source: context.source! }); // 数值叶子的 reviver 上下文必含原稿。
      }
      return value;
    });
  }

  /** `Object.is` 区分负零与零，仅未改变的数值复用原始表示。 */
  public stringify(value: JsonValue): string {
    const numbers = this.numbers;
    return JSON.stringify(value, function (this: object, key: string, current: JsonValue) {
      const original = numbers.get(this)?.get(key);
      return original && Object.is(current, original.value)
        ? json_with_source.rawJSON(original.source)
        : current;
    });
  }
}
