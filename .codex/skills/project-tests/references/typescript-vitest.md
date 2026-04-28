# TypeScript / Vitest 示例

只在任务涉及 TypeScript 纯逻辑、状态容器、selector、异步调度、API 客户端或 `*.test.ts` 时读取本文件。

## 基本形状

```ts
import { describe, expect, it } from "vitest";

import { createSessionStore } from "./session-store";

describe("createSessionStore", () => {
  it("合并服务端更新并推进受影响分区 revision", () => {
    const store = createSessionStore();

    store.applyServerUpdate({
      source: "sync",
      revision: 3,
      updatedSections: ["records"],
      operations: [
        {
          op: "merge_records",
          records: [{ id: 1, label: "新值", status: "DONE" }],
        },
      ],
    });

    expect(store.getState().records["1"]).toMatchObject({
      id: 1,
      label: "新值",
      status: "DONE",
    });
    expect(store.getState().revisions.sections.records).toBe(1);
  });
});
```

规则：
- 遵守“一业务文件一测试文件”：例如 `session-store.ts` 只对应 `session-store.test.ts`。
- 测试靠近被测文件或放在项目约定的测试目录；不要为同一业务文件拆出多个平行测试文件。
- 优先创建真实 store、真实 selector、真实纯函数输入。
- 只 mock 外部边界，不把同目录业务模块全部 `vi.mock` 掉。
- 使用显式类型或从被测模块导出的类型，避免为了测试扩大 `any`。

## 参数化

```ts
import { describe, expect, it } from "vitest";

describe("normalizeTaskStatus", () => {
  it.each([
    ["IDLE", false],
    ["RUNNING", true],
    ["DONE", false],
  ] as const)("把 %s 映射为 busy=%s", (status, expectedBusy) => {
    expect(normalizeTaskStatus(status).busy).toBe(expectedBusy);
  });
});
```

只在同一行为的输入矩阵上使用 `it.each`。

## Mock 使用点

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => {
  return {
    requestMock: vi.fn(),
  };
});

vi.mock("./transport", () => {
  return {
    request: requestMock,
  };
});

describe("loadSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("返回设置快照", async () => {
    requestMock.mockResolvedValue({
      settings: { language: "ja" },
    });

    const result = await loadSettings();

    expect(result.language).toBe("ja");
    expect(requestMock).toHaveBeenCalledWith("/settings");
  });
});
```

调用断言只作为补充；主要断言仍然是公开返回值、store 快照或事件结果。

## EventSource stub

```ts
function createEventSourceStub(): {
  eventSource: EventSource;
  emit: (eventName: string, payload: Record<string, unknown>) => void;
} {
  const listenerMap = new Map<string, EventListener>();

  return {
    eventSource: {
      addEventListener: vi.fn((eventName: string, listener: EventListener) => {
        listenerMap.set(eventName, listener);
      }),
      close: vi.fn(),
      onerror: null,
    } as unknown as EventSource,
    emit: (eventName: string, payload: Record<string, unknown>) => {
      const listener = listenerMap.get(eventName);
      if (listener === undefined) {
        throw new Error(`缺少事件监听器：${eventName}`);
      }

      listener({ data: JSON.stringify(payload) } as MessageEvent<string>);
    },
  };
}
```

用这个模式测试事件流消费时，断言最终 store、signal 或公开回调，不盯内部 listener map。

## 时间与异步

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

describe("createScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("到达间隔后触发刷新", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createScheduler(refresh, { intervalMs: 1000 });

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
```

fake timers 用完必须恢复。

## 常用验证

```powershell
npm --prefix frontend run test
npm --prefix frontend run test -- src/path/to/session-store.test.ts
npm --prefix frontend run lint
npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
```
