import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  service_options: [] as unknown[],
  workspace_options: [] as unknown[],
  agent_options: [] as unknown[],
  gateway_options: [] as unknown[],
  resource_start: vi.fn(),
  service_dispose: vi.fn(),
  agent_load: vi.fn(),
  agent_dispose: vi.fn(),
  web_dispose: vi.fn(),
  gateway_start: vi.fn(),
  gateway_stop: vi.fn(),
  stream_publish: vi.fn(),
  stream_stop: vi.fn(),
  set_stream_publisher: vi.fn(),
  resource_dispose: vi.fn(),
}));

const shared_state = {
  session: { marker: "session" },
  runtimeGate: { marker: "runtime-gate" },
  cache: { marker: "cache" },
  writes: { marker: "writes" },
};
const resources = {
  paths: { marker: "paths" },
  metadata: {
    read_version_or_default: () => "1.2.3",
    build_linguagacha_user_agent: () => "LinguaGacha/Test",
  },
  settings: {
    read_app_language: () => "ZH",
    set_stream_publisher: mocks.set_stream_publisher,
  },
  database: { marker: "database" },
  logManager: { marker: "log-manager", error: vi.fn() },
  dispose: mocks.resource_dispose,
};
const services = {
  model: { dispose: vi.fn(async () => undefined) },
  batchTranslation: { marker: "batch-translation" },
  state: shared_state,
  proofreading: { query: { marker: "proofreading" } },
  app: { marker: "app" },
  logManager: resources.logManager,
  dispose: mocks.service_dispose,
};
const stream = {
  publish: mocks.stream_publish,
  stop: mocks.stream_stop,
  create_stream_response: vi.fn(),
};
const agent = { load_resources: mocks.agent_load, dispose: mocks.agent_dispose };

vi.mock("./backend-resources", () => ({
  /** 由用例控制共享资源启动，并记录其生命周期顺序。 */
  BackendResources: class {
    /** 在启动真正完成前保持对应的测试等待点。 */
    public static async start(options: unknown): Promise<unknown> {
      mocks.events.push("resources:start");
      return await mocks.resource_start(options);
    }
  },
}));
vi.mock("./backend-services", () => ({
  /** 复用领域 fake，让断言聚焦组合根的依赖连接。 */
  BackendServices: class {
    /** 记录创建顺序和宿主端口，再交付共享服务。 */
    public constructor(options: unknown) {
      mocks.events.push("services:create");
      mocks.service_options.push(options);
      return services;
    }
  },
}));
vi.mock("../api/api-stream-hub", () => ({
  /** 以共享事件流 fake 观察订阅和清理连接。 */
  ApiStreamHub: class {
    /** 把事件流创建纳入启动顺序。 */
    public constructor() {
      mocks.events.push("stream:create");
      return stream;
    }
  },
}));
vi.mock("../agent/web-search-service", () => ({
  /** 隔离网络请求，保留搜索资源的创建与释放。 */
  WebSearchService: class {
    public readonly search = vi.fn();
    /** 记录搜索资源创建位置。 */
    public constructor() {
      mocks.events.push("web:create");
    }
    /** 允许模拟关闭失败，验证其它资源仍得到释放。 */
    public async dispose(): Promise<void> {
      mocks.events.push("web:dispose");
      await mocks.web_dispose();
    }
  },
}));
vi.mock("../agent/workspace/service", () => ({
  /** 隔离磁盘工作区，仅检查依赖的所有权。 */
  AgentWorkspaceService: class {
    /** 保存工作区端口与共享状态的注入关系。 */
    public constructor(options: unknown) {
      mocks.events.push("workspace:create");
      mocks.workspace_options.push(options);
    }
  },
}));
vi.mock("../agent/agent-service", () => ({
  /** 由用例控制 Agent 的资源加载与关闭。 */
  AgentService: class {
    /** 交付共享 Agent fake，使初始化和释放结果可控。 */
    public constructor(options: unknown) {
      mocks.events.push("agent:create");
      mocks.agent_options.push(options);
      return agent;
    }
  },
}));
vi.mock("../api/api-gateway-server", () => ({
  /** 隔离监听端口，保留 Gateway 的启动和关闭等待点。 */
  ApiGatewayServer: class {
    /** 记录 Gateway 对服务、Agent 与事件流的连接。 */
    public constructor(options: unknown) {
      mocks.events.push("gateway:create");
      mocks.gateway_options.push(options);
    }
    /** 模拟监听就绪或失败，验证启动回滚顺序。 */
    public async start(): Promise<unknown> {
      mocks.events.push("gateway:start");
      return await mocks.gateway_start();
    }
    /** 模拟监听关闭或失败，验证后续资源释放。 */
    public async stop(): Promise<void> {
      mocks.events.push("gateway:stop");
      await mocks.gateway_stop();
    }
  },
}));

import { GuiBackendBootstrap } from "./gui-backend-bootstrap";

beforeEach(() => {
  mocks.events.length = 0;
  mocks.service_options.length = 0;
  mocks.workspace_options.length = 0;
  mocks.agent_options.length = 0;
  mocks.gateway_options.length = 0;
  mocks.resource_start.mockReset().mockResolvedValue(resources);
  mocks.service_dispose
    .mockReset()
    .mockImplementation(async () => mocks.events.push("services:dispose"));
  mocks.agent_load.mockReset().mockImplementation(async () => mocks.events.push("agent:load"));
  mocks.agent_dispose
    .mockReset()
    .mockImplementation(async () => mocks.events.push("agent:dispose"));
  mocks.web_dispose.mockReset();
  mocks.gateway_start.mockReset().mockResolvedValue({ baseUrl: "http://127.0.0.1:4567" });
  mocks.gateway_stop.mockReset();
  mocks.stream_publish.mockReset();
  mocks.stream_stop.mockReset().mockImplementation(() => mocks.events.push("stream:stop"));
  mocks.set_stream_publisher.mockReset();
  mocks.resource_dispose
    .mockReset()
    .mockImplementation(async () => mocks.events.push("resources:dispose"));
});

describe("GuiBackendBootstrap", () => {
  it("用共享状态组装必需 Agent、事件流与 Gateway", async () => {
    const options = create_options();
    const bootstrap = new GuiBackendBootstrap(options);

    const result = await bootstrap.start();

    expect(result).toMatchObject({
      apiBaseUrl: "http://127.0.0.1:4567",
      backendServices: services,
    });
    expect(mocks.workspace_options[0]).toMatchObject({
      sessionState: shared_state.session,
      cache: shared_state.cache,
      runtimeGate: shared_state.runtimeGate,
      writeStore: shared_state.writes,
    });
    const service_options = mocks.service_options[0] as {
      openOutputFolder: (path: string) => Promise<void>;
    };
    await service_options.openOutputFolder("E:/output");
    expect(options.openDirectory).toHaveBeenCalledExactlyOnceWith("E:/output");
    expect(mocks.agent_options[0]).toMatchObject({
      batchTranslation: services.batchTranslation,
      sessionState: shared_state.session,
      runtimeGate: shared_state.runtimeGate,
    });
    expect(mocks.gateway_options[0]).toEqual({
      backendServices: services,
      agentService: agent,
      eventStream: stream,
    });
    expect(mocks.set_stream_publisher).toHaveBeenCalledWith(stream);

    await bootstrap.stop();

    expect(mocks.events.slice(-6)).toEqual([
      "gateway:stop",
      "agent:dispose",
      "web:dispose",
      "stream:stop",
      "services:dispose",
      "resources:dispose",
    ]);
    expect(mocks.set_stream_publisher).toHaveBeenLastCalledWith(null);
  });

  it("Agent 资源加载失败时仍按已创建资源逆序清理", async () => {
    const failure = new Error("system prompt missing");
    mocks.agent_load.mockRejectedValue(failure);
    const bootstrap = new GuiBackendBootstrap(create_options());

    const error = await bootstrap.start().catch((reason: unknown) => reason);

    expect(error).toBe(failure);
    expect(mocks.gateway_start).not.toHaveBeenCalled();
    expect(mocks.events).toContain("agent:dispose");
    expect(mocks.events).toContain("web:dispose");
    expect(mocks.events).toContain("services:dispose");
    expect(mocks.events).toContain("resources:dispose");
  });

  it("启动期间停止会等待资源落位并关闭完整生命周期", async () => {
    let mark_gateway_entered: () => void = () => undefined;
    const gateway_entered = new Promise<void>((resolve) => {
      mark_gateway_entered = resolve;
    });
    let release_gateway: (value: { baseUrl: string }) => void = () => undefined;
    mocks.gateway_start.mockImplementationOnce(
      async () =>
        await new Promise<{ baseUrl: string }>((resolve) => {
          release_gateway = resolve;
          mark_gateway_entered();
        }),
    );
    const bootstrap = new GuiBackendBootstrap(create_options());
    const starting = bootstrap.start();
    await gateway_entered;

    const stopping = bootstrap.stop();
    release_gateway({ baseUrl: "http://127.0.0.1:4567" });

    await expect(starting).rejects.toMatchObject({ code: "runtime.disposed" });
    await expect(stopping).resolves.toBeUndefined();
    expect(bootstrap.isStopped()).toBe(true);
    expect(mocks.resource_dispose).toHaveBeenCalledOnce();
  });

  it("关闭步骤失败时继续释放全部资源并汇总异常", async () => {
    const failures = [
      new Error("gateway stop failed"),
      new Error("agent dispose failed"),
      new Error("web dispose failed"),
      new Error("services dispose failed"),
      new Error("resources dispose failed"),
    ];
    mocks.gateway_stop.mockRejectedValueOnce(failures[0]);
    mocks.agent_dispose.mockRejectedValueOnce(failures[1]);
    mocks.web_dispose.mockRejectedValueOnce(failures[2]);
    mocks.service_dispose.mockRejectedValueOnce(failures[3]);
    mocks.resource_dispose.mockRejectedValueOnce(failures[4]);
    const bootstrap = new GuiBackendBootstrap(create_options());
    await bootstrap.start();

    const error = await bootstrap.stop().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual(failures);
    expect(mocks.gateway_stop).toHaveBeenCalledOnce();
    expect(mocks.agent_dispose).toHaveBeenCalledOnce();
    expect(mocks.web_dispose).toHaveBeenCalledOnce();
    expect(mocks.service_dispose).toHaveBeenCalledOnce();
    expect(mocks.resource_dispose).toHaveBeenCalledOnce();
  });
});

/** 为每个用例提供独立宿主回调，避免副作用调用记录串扰。 */
function create_options() {
  return {
    imageHost: async () => {
      throw new Error("Unexpected image request.");
    },
    appRoot: "E:/app",
    builtinRoot: "E:/app.asar/builtin",
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
    workspaceRuntimeDirectory: "runtime",
    openDirectory: vi.fn(),
    pickSavePath: vi.fn(async () => null),
    workerExecution: { kind: "in_process" as const },
  };
}
