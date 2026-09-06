import type { TSchema } from "@earendil-works/pi-ai";
import { Errors } from "typebox/value";

/** 将结构校验失败收口为可修复的字段信息，避免向模型回传整个 Schema 或输入。 */
export function describe_agent_workspace_schema_error(
  schema: TSchema,
  value: unknown,
): {
  path: string;
  message: string;
} {
  // 判别联合只解释与当前字面标志匹配的分支，避免提示另一种工具用法的必填字段。
  const variants = (
    schema as { anyOf?: Array<TSchema & { properties?: Record<string, { const?: unknown }> }> }
  ).anyOf;
  const branch = variants?.find((variant) => {
    const literals = Object.entries(variant.properties ?? {}).filter(
      ([, property]) => "const" in property,
    );
    return (
      literals.length > 0 &&
      typeof value === "object" &&
      value !== null &&
      literals.every(
        ([name, property]) => (value as Record<string, unknown>)[name] === property.const,
      )
    );
  });
  const errors = Errors(branch ?? schema, value);
  const error =
    errors.find((entry) => entry.keyword !== "anyOf" && entry.keyword !== "oneOf") ?? errors[0];
  const missing = error?.keyword === "required" ? error.params.requiredProperties[0] : undefined;
  return {
    path:
      missing === undefined
        ? error?.instancePath || "/"
        : `${error?.instancePath ?? ""}/${missing.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    message:
      error === undefined
        ? "Value does not match the declared schema."
        : `${error.message} (${JSON.stringify(error.params)})`,
  };
}
