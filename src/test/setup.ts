import { afterEach, vi } from "vitest";

declare module "vitest" {
  /** `globalSetup` 在测试收集前提供只读资源，类型与 Vitest 注入入口保持一致。 */
  export interface ProvidedContext {
    workspaceRuntimeDirectory: string;
  }
}

afterEach(() => vi.useRealTimers());
