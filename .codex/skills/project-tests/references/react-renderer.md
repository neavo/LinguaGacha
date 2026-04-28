# React 测试示例

只在任务涉及 React Hook、Context、页面状态、组件交互、DOM 结果或 `*.test.tsx` 时读取本文件。

## 渲染 provider 与探针

使用 `react-dom/client`、`act` 与测试环境 DOM 时，优先通过最小探针读取公开 hook/context 结果。

```tsx
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

function SessionProbe(props: {
  onSnapshot: (snapshot: SessionSnapshot) => void;
}): JSX.Element | null {
  const session = useSessionRuntime();

  useEffect(() => {
    props.onSnapshot({
      status: session.status,
      version: session.version,
    });
  }, [
    props,
    session.status,
    session.version,
  ]);

  return null;
}

describe("SessionRuntimeProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  it("初始化完成后发布运行态快照", async () => {
    const snapshots: SessionSnapshot[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <SessionRuntimeProvider>
          <SessionProbe onSnapshot={(snapshot) => snapshots.push(snapshot)} />
        </SessionRuntimeProvider>,
      );
    });

    expect(snapshots.at(-1)).toMatchObject({
      status: "ready",
      version: 1,
    });
  });
});
```

## 等待状态收敛

```tsx
async function waitForCondition(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await Promise.resolve();
    });
  }

  throw new Error("等待运行时状态收敛失败。");
}
```

不要用固定 `setTimeout` 硬等；等待明确条件。

## 组件交互

如果没有引入 Testing Library，就直接使用 DOM API 触发事件；断言 DOM 或公开回调。

```tsx
it("点击保存后提交当前表单值", async () => {
  const submitted: string[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(<NameEditor onSubmit={(value) => submitted.push(value)} />);
  });

  const input = container.querySelector("input");
  const button = container.querySelector("button");
  if (input === null || button === null) {
    throw new Error("缺少表单控件。");
  }

  await act(async () => {
    input.value = "绿之塔";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    button.click();
  });

  expect(submitted).toEqual(["绿之塔"]);
});
```

## UI 边界

- 遵守“一业务文件一测试文件”；组件或 Hook 的具体断言放进它的唯一对应测试文件。
- UI 测试 mock 公开桥接适配器，不要直连系统 API、桌面宿主或真实后端。
- 对页面状态 Hook，优先断言公开返回值和提交 payload。
- 对 Context/provider，优先通过探针组件收集快照。
- 对视觉和样式规则，单元测试只测语义状态；视觉核对交给项目约定的审计或浏览器检查。

## 常用验证

```powershell
npm --prefix frontend run test -- src/path/to/session-runtime-provider.test.tsx
npm --prefix frontend run test
npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
```
