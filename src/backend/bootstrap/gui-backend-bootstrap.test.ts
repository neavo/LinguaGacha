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
  BackendResources: class {
    public static async start(options: unknown): Promise<unknown> {
      mocks.events.push("resources:start");
      return await mocks.resource_start(options);
    }
  },
}));
vi.mock("./backend-services", () => ({
  BackendServices: class {
    public constructor(options: unknown) {
      mocks.events.push("services:create");
      mocks.service_options.push(options);
      return services;
    }
  },
}));
vi.mock("../api/api-stream-hub", () => ({
  ApiStreamHub: class {
    public constructor() {
      mocks.events.push("stream:create");
      return stream;
    }
  },
}));
vi.mock("../agent/web-search-service", () => ({
  WebSearchService: class {
    public readonly search = vi.fn();
    public constructor() {
      mocks.events.push("web:create");
    }
    public async dispose(): Promise<void> {
      mocks.events.push("web:dispose");
      await mocks.web_dispose();
    }
  },
}));
vi.mock("../agent/workspace/service", () => ({
  AgentWorkspaceService: class {
    public constructor(options: unknown) {
      mocks.events.push("workspace:create");
      mocks.workspace_options.push(options);
    }
  },
}));
vi.mock("../agent/agent-service", () => ({
  AgentService: class {
    public constructor(options: unknown) {
      mocks.events.push("agent:create");
      mocks.agent_options.push(options);
      return agent;
    }
  },
}));
vi.mock("../api/api-gateway-server", () => ({
  ApiGatewayServer: class {
    public constructor(options: unknown) {
      mocks.events.push("gateway:create");
      mocks.gateway_options.push(options);
    }
    public async start(): Promise<unknown> {
      mocks.events.push("gateway:start");
      return await mocks.gateway_start();
    }
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
    const bootstrap = new GuiBackendBootstrap(create_options());

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
    expect(mocks.agent_options[0]).toMatchObject({
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

function create_options() {
  return {
    appRoot: "E:/app",
    builtinRoot: "E:/app.asar/builtin",
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
    agentWorkspaceRun: vi.fn(),
    openOutputFolder: vi.fn(),
    workerExecution: { kind: "in_process" as const },
  };
}
