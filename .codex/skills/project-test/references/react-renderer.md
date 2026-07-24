# React 测试

只在任务涉及 React 组件、Hook、Context 或 UI 状态时读取本文件。复用项目已经安装的渲染和交互工具，不为示例新增依赖。

## 选择观察面

优先级通常是：

1. 用户能看到或操作的 DOM、可访问名称和状态；
2. 组件公开回调或提交载荷；
3. Hook 或 Context 的公开返回值；
4. 只有当实现细节本身就是契约时，才检查调用记录。

## 组件交互

项目已有 Testing Library 时使用其查询和用户交互 API；没有时，可用 `react-dom/client`、`act` 和原生 DOM 完成最小验证。

```tsx
it("提交当前输入值", async () => {
  const submitted: string[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(<NameEditor onSubmit={(value) => submitted.push(value)} />);
  });

  const input = container.querySelector("input");
  const button = container.querySelector("button");
  if (input === null || button === null) {
    throw new Error("缺少表单控件");
  }

  await act(async () => {
    input.value = "Ada";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    button.click();
  });

  expect(submitted).toEqual(["Ada"]);
  await act(async () => root.unmount());
});
```

优先使用项目工具提供的自动清理；手动创建 root 时必须卸载并清理 DOM。

## Hook 与 Context

只有公开状态无法通过现有 UI 观察时，才写最小探针组件：

```tsx
function StatusProbe(props: { onChange: (status: string) => void }) {
  const { status } = useJobStatus();

  useEffect(() => props.onChange(status), [props, status]);
  return null;
}
```

探针只暴露公开返回值，不复制 provider 内部结构，也不访问私有 setter。

## 异步状态

- 使用已安装测试库的 `findBy*`、`waitFor`，或等待明确 Promise、事件和状态条件。
- 不用固定睡眠掩盖竞态。
- 用 fake timer 时显式推进并恢复。
- 对卸载、取消和错误状态补测试，仅当它们属于真实产品路径或历史缺陷。

项目已有 Testing Library 时，等待用户可见结果：

```tsx
it("异步完成后显示任务结果", async () => {
  render(<JobStatus load={() => Promise.resolve("done")} />);

  expect(await screen.findByRole("status")).toHaveTextContent("done");
});
```

## UI 边界

- mock 浏览器外的宿主适配器、远程 API 或系统接口，不在组件测试中连接真实后端。
- 单元测试验证语义状态；像素布局、裁剪和响应式行为交给浏览器或视觉验证。
- 保留可访问性基础：优先按角色、标签和可见文本定位交互目标。
- 文件组织遵循项目约定；组件、Hook 和集成场景可按测试层级合理拆分。

## 验证

使用项目现有包管理器和脚本执行目标测试，再按风险运行相关套件、lint、类型检查和必要的浏览器验证。不要假设仓库一定使用 npm、Vitest 配置根目录或特定 DOM 环境。
