import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PiCatalogModel } from "./model-capability";
import { afterEach, describe, expect, it, vi } from "vitest";

const builtin = vi.hoisted(() => ({
  alpha: {
    id: "shared",
    provider: "alpha",
    baseUrl: "https://alpha.example/v1",
    api: "openai-completions",
    reasoning: false,
    contextWindow: 100,
    maxTokens: 20,
  },
  beta: {
    id: "other",
    provider: "beta",
    baseUrl: "https://beta.example/v1",
    api: "anthropic-messages",
    reasoning: false,
    contextWindow: 200,
    maxTokens: 40,
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  getBuiltinProviders: () => ["alpha", "beta", "gamma"],
  getBuiltinModels: (provider: string) =>
    Object.values(builtin).filter((model) => model.provider === provider),
  getBuiltinModelDataGeneratedAt: () => Date.parse("2026-01-01T00:00:00Z"),
}));

import { PiModelCatalog } from "./pi-model-catalog";

const modified = "Mon, 01 Jun 2026 00:00:00 GMT";
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 用临时文件验证真实缓存读写，网络由各用例提供。 */
async function create_catalog() {
  const root = await mkdtemp(path.join(tmpdir(), "lg-pi-catalog-"));
  roots.push(root);
  const file_path = path.join(root, "userdata", "pi-model-catalog.json");
  const warning = vi.fn();
  const paths = {
    get_user_data_path: (...parts: string[]) => path.join(root, "userdata", ...parts),
  };
  return { catalog: new PiModelCatalog(paths, { warning }), paths, file_path, warning };
}

/** 构造供应商响应，日期与 ETag 用于检查条件请求和新旧判断。 */
function response(provider: "alpha" | "beta", changes: Record<string, unknown> = {}): Response {
  const model = { ...builtin[provider], ...changes };
  return new Response(JSON.stringify({ [model.id]: model }), {
    status: 200,
    headers: { "Last-Modified": modified, ETag: '"new"', "Content-Type": "application/json" },
  });
}

describe("PiModelCatalog", () => {
  it("已知供应商的空目录正常缓存，后续较新目录纳入新增聊天模型", async () => {
    const { catalog, paths, file_path, warning } = await create_catalog();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/gamma")
          ? new Response("{}", {
              status: 200,
              headers: { "Last-Modified": modified, ETag: '"empty"' },
            })
          : new Response(null, { status: 304 }),
      ),
    );
    const apply = vi.fn(async (_models: readonly PiCatalogModel[], commit: () => void) => commit());
    await catalog.check(apply);
    expect(warning).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file_path, "utf8")).providers.gamma).toEqual({
      modified: Date.parse(modified),
      etag: '"empty"',
      models: [],
    });

    const restarted = new PiModelCatalog(paths, { warning });
    const added = { ...builtin.alpha, provider: "gamma", id: "future" };
    const newer = "Tue, 02 Jun 2026 00:00:00 GMT";
    const fetch_mock = vi.fn(async (url: string, _options: RequestInit) =>
      url.endsWith("/gamma")
        ? new Response(JSON.stringify({ future: added }), {
            status: 200,
            headers: { "Last-Modified": newer, ETag: '"added"' },
          })
        : new Response(null, { status: 304 }),
    );
    vi.stubGlobal("fetch", fetch_mock);
    await restarted.check(apply);
    expect(fetch_mock.mock.calls).toContainEqual([
      expect.stringContaining("/gamma"),
      expect.objectContaining({ headers: { "If-None-Match": '"empty"' } }),
    ]);
    expect(restarted.read_models()).toEqual([builtin.alpha, builtin.beta, added]);
    expect(apply).toHaveBeenCalledOnce();
    expect(warning).not.toHaveBeenCalled();
  });

  it("较新空目录清除旧覆盖并恢复基线，重启和 304 保留空缓存与其它供应商", async () => {
    const { paths, file_path, warning } = await create_catalog();
    const overridden = { ...builtin.alpha, reasoning: true, contextWindow: 300 };
    const added = { ...overridden, id: "remote-only" };
    const other = { ...builtin.beta, contextWindow: 400 };
    const previous = {
      version: 2,
      providers: {
        alpha: { modified: Date.parse(modified), etag: '"old"', models: [overridden, added] },
        beta: { modified: Date.parse(modified), etag: '"other"', models: [other] },
      },
    };
    await mkdir(path.dirname(file_path), { recursive: true });
    await writeFile(file_path, JSON.stringify(previous));
    const catalog = new PiModelCatalog(paths, { warning });
    expect(catalog.read_models()).toEqual([overridden, other, added]);

    const newer = "Tue, 02 Jun 2026 00:00:00 GMT";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/alpha")
          ? new Response("{}", { status: 200, headers: { "Last-Modified": newer } })
          : new Response(null, { status: 304 }),
      ),
    );
    const apply = vi.fn(async (_models: readonly PiCatalogModel[], commit: () => void) => commit());
    await catalog.check(apply);
    expect(catalog.read_models()).toEqual([builtin.alpha, other]);
    expect(apply).toHaveBeenCalledOnce();
    const cached = JSON.parse(await readFile(file_path, "utf8"));
    expect(cached.providers.alpha).toEqual({ modified: Date.parse(newer), models: [] });
    expect(cached.providers.beta).toEqual(previous.providers.beta);

    const restarted = new PiModelCatalog(paths, { warning });
    expect(restarted.read_models()).toEqual([builtin.alpha, other]);
    const fetch_unchanged = vi.fn(
      async (_url: string, _options: RequestInit) => new Response(null, { status: 304 }),
    );
    vi.stubGlobal("fetch", fetch_unchanged);
    apply.mockClear();
    await restarted.check(apply);
    expect(fetch_unchanged.mock.calls).toContainEqual([
      expect.stringContaining("/alpha"),
      expect.objectContaining({ headers: { "If-Modified-Since": newer } }),
    ]);
    expect(restarted.read_models()).toEqual([builtin.alpha, other]);
    expect(apply).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(file_path, "utf8"))).toEqual(cached);
    expect(warning).not.toHaveBeenCalled();
  });

  it("合并较新供应商目录并经链接持久化，离线重启继续使用缓存", async () => {
    const { catalog, paths, file_path, warning } = await create_catalog();
    const target_path = `${file_path}.target`;
    await mkdir(path.dirname(file_path), { recursive: true });
    await writeFile(target_path, "{}");
    // Windows 文件软连接需要额外权限，硬链接同样能检验写入是否替换了原路径。
    if (process.platform === "win32") await link(target_path, file_path);
    else await symlink(target_path, file_path, "file");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/alpha")
          ? response("alpha", { reasoning: true, contextWindow: 300 })
          : url.endsWith("/beta")
            ? new Response("", { status: 404 })
            : new Response("{bad json", { status: 200, headers: { "Last-Modified": modified } }),
      ),
    );
    let applied: readonly PiCatalogModel[] = [];
    await catalog.check(async (models, commit) => {
      applied = models;
      commit();
    });
    expect(applied.find((model) => model.provider === "alpha")).toMatchObject({
      reasoning: true,
      contextWindow: 300,
    });
    expect(applied.find((model) => model.provider === "beta")?.contextWindow).toBe(200);
    expect(catalog.get_snapshot().revision).toBe(1);
    for (const provider of ["beta", "gamma"])
      expect(warning).toHaveBeenCalledWith(expect.any(String), {
        error: expect.any(Error),
        context: { provider },
        targets: { console: false, window: false },
      });
    expect(JSON.parse(await readFile(file_path, "utf8")).providers.alpha.etag).toBe('"new"');
    expect(await readFile(target_path, "utf8")).toBe(await readFile(file_path, "utf8"));

    const offline = new PiModelCatalog(paths, { warning: vi.fn() });
    expect(offline.read_models().find((model) => model.provider === "alpha")?.contextWindow).toBe(
      300,
    );
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/alpha"))
        expect((options.headers as Record<string, string>)["If-None-Match"]).toBe('"new"');
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal("fetch", fetch);
    const apply = vi.fn();
    await offline.check(async () => {
      apply();
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("坏缓存和早于内置的缓存回退，旧远端结果保留已有有效缓存", async () => {
    const { paths, file_path } = await create_catalog();
    await mkdir(path.dirname(file_path), { recursive: true });
    await writeFile(file_path, "{bad json");
    const warning = vi.fn();
    expect(new PiModelCatalog(paths, { warning }).read_models()[0]?.contextWindow).toBe(100);
    expect(warning).toHaveBeenCalledWith(expect.any(String), {
      error: expect.any(Error),
      targets: { console: false, window: false },
    });

    await writeFile(
      file_path,
      JSON.stringify({
        version: 2,
        providers: {
          alpha: {
            modified: Date.parse("2025-12-31T00:00:00Z"),
            models: [{ ...builtin.alpha, contextWindow: 999 }],
          },
        },
      }),
    );
    expect(new PiModelCatalog(paths, { warning: vi.fn() }).read_models()[0]?.contextWindow).toBe(
      100,
    );

    await writeFile(
      file_path,
      JSON.stringify({
        version: 2,
        providers: {
          alpha: {
            modified: Date.parse(modified),
            etag: '"cached"',
            models: [{ ...builtin.alpha, contextWindow: 300 }],
          },
        },
      }),
    );
    const cached = new PiModelCatalog(paths, { warning: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/alpha")
          ? new Response(JSON.stringify({ shared: { ...builtin.alpha, contextWindow: 150 } }), {
              status: 200,
              headers: { "Last-Modified": "Sun, 31 May 2026 00:00:00 GMT" },
            })
          : new Response(null, { status: 304 }),
      ),
    );
    const apply = vi.fn();
    await cached.check(async () => {
      apply();
    });
    expect(cached.read_models().find((model) => model.provider === "alpha")?.contextWindow).toBe(
      300,
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("字段顺序和元数据变化不提示，非法兼容字段保留旧供应商", async () => {
    const { paths, file_path } = await create_catalog();
    await mkdir(path.dirname(file_path), { recursive: true });
    await writeFile(
      file_path,
      JSON.stringify({
        version: 2,
        providers: {
          alpha: {
            modified: Date.parse(modified),
            etag: '"old"',
            models: [
              {
                ...builtin.alpha,
                compat: { supportsStore: true, supportsReasoningEffort: false },
              },
            ],
          },
        },
      }),
    );
    const catalog = new PiModelCatalog(paths, { warning: vi.fn() });
    const newer = "Tue, 02 Jun 2026 00:00:00 GMT";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/alpha")
          ? new Response(
              JSON.stringify({
                shared: {
                  compat: { supportsReasoningEffort: false, supportsStore: true },
                  ...builtin.alpha,
                  name: "Changed label",
                },
              }),
              { status: 200, headers: { "Last-Modified": newer } },
            )
          : new Response(null, { status: 304 }),
      ),
    );
    const apply = vi.fn();
    await catalog.check(async () => {
      apply();
    });
    expect(apply).not.toHaveBeenCalled();
    expect(catalog.get_snapshot().revision).toBe(0);

    const warning = vi.fn();
    const invalid = new PiModelCatalog(paths, { warning });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/alpha")
          ? new Response(
              JSON.stringify({
                shared: { ...builtin.alpha, compat: { supportsStore: "yes" }, contextWindow: 999 },
              }),
              {
                status: 200,
                headers: { "Last-Modified": "Wed, 03 Jun 2026 00:00:00 GMT" },
              },
            )
          : new Response(null, { status: 304 }),
      ),
    );
    await invalid.check(async () => {
      apply();
    });
    expect(invalid.read_models().find((model) => model.provider === "alpha")?.contextWindow).toBe(
      100,
    );
    expect(warning).toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("退出取消在途下载，不应用半成品", async () => {
    const { catalog, warning } = await create_catalog();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const apply = vi.fn();
    const checking = catalog.check(async () => {
      apply();
    });
    catalog.dispose();
    await checking;
    expect(apply).not.toHaveBeenCalled();
    expect(catalog.get_snapshot().revision).toBe(0);
    expect(warning).not.toHaveBeenCalled();
  });

  it("总超时保留已完成供应商并应用部分有效更新", async () => {
    vi.useFakeTimers();
    try {
      const { catalog, warning } = await create_catalog();
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, options: RequestInit) =>
          url.endsWith("/alpha")
            ? Promise.resolve(response("alpha", { contextWindow: 300 }))
            : new Promise<Response>((_resolve, reject) => {
                options.signal?.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                );
              }),
        ),
      );
      const apply = vi.fn(async (_models: readonly PiCatalogModel[], commit: () => void) => {
        commit();
      });
      const checking = catalog.check(apply);
      await vi.runAllTimersAsync();
      await checking;
      expect(catalog.read_models().find((model) => model.provider === "alpha")?.contextWindow).toBe(
        300,
      );
      expect(apply).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith(expect.any(String), {
        targets: { console: false, window: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("仅地址变化也发布能力更新，缓存重启保留地址", async () => {
    const { catalog, paths } = await create_catalog();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/alpha")
          ? response("alpha", { baseUrl: "https://new.example/v1" })
          : new Response(null, { status: 304 }),
      ),
    );
    const apply = vi.fn(async (_models, commit) => commit());
    await catalog.check(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(
      new PiModelCatalog(paths, { warning: vi.fn() })
        .read_models()
        .find((model) => model.provider === "alpha")?.baseUrl,
    ).toBe("https://new.example/v1");
  });

  it("缺少地址的旧版缓存使用内置目录重建且不复用条件请求凭据", async () => {
    const { paths, file_path } = await create_catalog();
    await mkdir(path.dirname(file_path), { recursive: true });
    await writeFile(
      file_path,
      JSON.stringify({
        version: 1,
        providers: {
          alpha: {
            modified: Date.parse(modified),
            etag: '"old"',
            models: [{ ...builtin.alpha, baseUrl: undefined }],
          },
        },
      }),
    );
    const catalog = new PiModelCatalog(paths, { warning: vi.fn() });
    const fetch_mock = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetch_mock);
    await catalog.check(async (_models, commit) => commit());
    expect(catalog.read_models().find((model) => model.provider === "alpha")?.baseUrl).toBe(
      builtin.alpha.baseUrl,
    );
    expect(fetch_mock.mock.calls).toEqual(
      expect.arrayContaining([
        [expect.stringContaining("/alpha"), expect.objectContaining({ headers: {} })],
      ]),
    );
  });

  it("缓存供应商条目损坏时仅保留文件诊断，其他有效缓存继续可用", async () => {
    const { paths, file_path, warning } = await create_catalog();
    await mkdir(path.dirname(file_path), { recursive: true });
    await writeFile(
      file_path,
      JSON.stringify({
        version: 2,
        providers: {
          alpha: { modified: "invalid", models: [{ ...builtin.alpha, contextWindow: 999 }] },
          beta: {
            modified: Date.parse(modified),
            models: [{ ...builtin.beta, contextWindow: 300 }],
          },
          gamma: {
            modified: Date.parse(modified),
            models: [{ ...builtin.alpha, provider: "gamma", contextWindow: 0 }],
          },
        },
      }),
    );
    const catalog = new PiModelCatalog(paths, { warning });
    expect(catalog.read_models()).toEqual([builtin.alpha, { ...builtin.beta, contextWindow: 300 }]);
    for (const provider of ["alpha", "gamma"])
      expect(warning).toHaveBeenCalledWith(expect.any(String), {
        error: expect.any(Error),
        context: { provider },
        targets: { console: false, window: false },
      });
  });

  it("缓存写入失败时保留可见警告且不切换当前目录", async () => {
    const { catalog, file_path, warning } = await create_catalog();
    await mkdir(file_path, { recursive: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/alpha")
          ? response("alpha", { contextWindow: 300 })
          : new Response(null, { status: 304 }),
      ),
    );
    const apply = vi.fn();
    await catalog.check(apply);
    expect(catalog.read_models()).toEqual([builtin.alpha, builtin.beta]);
    expect(catalog.get_snapshot().revision).toBe(0);
    expect(warning).toHaveBeenCalledWith(expect.any(String), {
      error: expect.any(Error),
    });
    expect(apply).not.toHaveBeenCalled();
  });
});
