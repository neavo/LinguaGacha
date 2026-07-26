# TypeScript / Vitest

只在任务涉及 TypeScript 或 Vitest 时读取本文件。以下只补充 Vitest、模块 mock 和 TypeScript 工具链的特有做法。

## 基本形状

```ts
import { describe, expect, it } from "vitest";

import { calculateTotal } from "./cart";

describe("calculateTotal", () => {
  it("汇总商品金额并应用折扣", () => {
    const total = calculateTotal(
      [{ price: 20, quantity: 2 }],
      { discount: 5 },
    );

    expect(total).toBe(35);
  });
});
```

只有同一种行为的输入矩阵才使用 `it.each`。

## 状态与异步逻辑

- 等待明确的 Promise、事件或状态条件，不使用固定 `setTimeout`。
- 使用 fake timer 后恢复真实 timer。

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";

afterEach(() => vi.useRealTimers());

it("到达间隔后触发刷新", () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const scheduler = createScheduler(refresh, { intervalMs: 1000 });

  scheduler.start();
  vi.advanceTimersByTime(1000);

  expect(refresh).toHaveBeenCalledTimes(1);
});
```

此处调用次数就是调度器的公开契约；普通业务测试仍应优先断言结果。

## Mock 边界

使用 `vi.mock` 时保持模块边界窄小，并在每个测试间重置状态。

```ts
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("./transport", () => ({ request: requestMock }));

beforeEach(() => requestMock.mockReset());

it("返回服务端设置", async () => {
  requestMock.mockResolvedValue({ language: "ja" });

  const result = await loadSettings();

  expect(result).toEqual({ language: "ja" });
  expect(requestMock).toHaveBeenCalledWith("/settings");
});
```

不要把同一领域的一串模块全部 mock 掉；那通常只会验证测试自己搭出的剧本。

## 验证

先识别 `package.json` 脚本、锁文件、Vitest 配置和工作区边界，再使用对应包管理器。常见形状仅供匹配现有项目：

```text
npm test -- path/to/module.test.ts
pnpm test path/to/module.test.ts
vitest run path/to/module.test.ts
tsc -p tsconfig.json --noEmit
```

不要绕过项目脚本导致读取错误配置。
