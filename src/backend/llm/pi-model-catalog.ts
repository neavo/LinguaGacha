import crypto from "node:crypto";
import type { ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { PiCatalogModel } from "./model-capability";
import {
  getBuiltinModelDataGeneratedAt,
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";

import type { AppPathService } from "../app/app-path-service";
import type { LogManager } from "../log/log-manager";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { ModelCatalogSnapshot } from "../../shared/model-catalog";

/** 消费方只能读取当前目录，更新由组合根编排。 */
export type PiModelCatalogReader = Pick<PiModelCatalog, "read_models">;
type ProviderEntry = { modified: number; etag?: string; models: PiCatalogModel[] };
type CatalogCache = { version: 1; providers: Record<string, ProviderEntry> };
const CATALOG_FILE = "pi-model-catalog.json";
const REMOTE_ROOT = "https://pi.dev/api/models/providers/";
const CHECK_TIMEOUT_MS = 15_000;
const CHECK_CONCURRENCY = 4;
/** 内置目录与远端缓存共用能力类型，纯解析器只接收调用方提供的数据。 */
export function read_builtin_pi_models(): readonly PiCatalogModel[] {
  return getBuiltinProviders().flatMap((provider) => getBuiltinModels(provider));
}

/** 应用实例持有的一份 Pi 能力事实；网络检查只产生候选，应用由 ModelService 编排。 */
export class PiModelCatalog {
  private readonly providers: readonly string[] = getBuiltinProviders(); // 更新范围沿用当前依赖包的供应商集合。
  private readonly builtin = read_builtin_pi_models(); // 离线基线随应用版本更新。
  private readonly generated_at = getBuiltinModelDataGeneratedAt() ?? 0; // 缓存和远端数据取得覆盖优先级的时间下限。
  private readonly file_path: string;
  private cache: CatalogCache = { version: 1, providers: {} }; // 保存远端数据及条件请求凭据。
  private models: readonly PiCatalogModel[]; // 当前请求可见的完整能力快照。
  private revision = 0;
  private readonly instance_id = crypto.randomUUID();
  private readonly started_at = Math.round((performance.timeOrigin + performance.now()) * 1000);
  private controller: AbortController | null = null; // 退出时同时取消下载和空闲等待。

  /** 启动时读取有效缓存，单个供应商损坏时保留其它供应商的能力。 */
  public constructor(
    paths: Pick<AppPathService, "get_user_data_path">,
    private readonly log: Pick<LogManager, "warning">,
    private readonly native_fs: NativeFs = default_native_fs,
  ) {
    this.file_path = paths.get_user_data_path(CATALOG_FILE);
    try {
      if (native_fs.exists(this.file_path)) {
        const parsed: unknown = JSON.parse(native_fs.read_text_file(this.file_path));
        this.cache = this.read_cache(parsed);
      }
    } catch (error) {
      this.log.warning("Pi 模型能力缓存无效，使用内置目录。", { error });
    }
    this.models = this.merge(this.cache);
  }

  /** 返回当前有效快照，调用方在本次同步能力解析中使用同一份数据。 */
  public read_models(): readonly PiCatalogModel[] {
    return this.models;
  }

  /** 为首次连接、重连和更新事件提供同一份通知标记。 */
  public get_snapshot(): ModelCatalogSnapshot {
    return { instance_id: this.instance_id, started_at: this.started_at, revision: this.revision };
  }

  /** 组合根每次启动调用一次，供应商失败时沿用上次成功数据。 */
  public async check(
    apply: (
      models: readonly PiCatalogModel[],
      commit: () => void,
      signal: AbortSignal,
    ) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    const fetch_controller = new AbortController();
    this.controller = controller;
    // 网络超时结束本轮下载，应用等待只响应后端退出。
    const fetch_signal = AbortSignal.any([controller.signal, fetch_controller.signal]);
    const timeout = setTimeout(() => fetch_controller.abort(), CHECK_TIMEOUT_MS);
    const providers = this.providers;
    const next: CatalogCache = {
      version: 1,
      providers: { ...this.cache.providers },
    };
    let cursor = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(CHECK_CONCURRENCY, providers.length) }, async () => {
          while (!fetch_signal.aborted) {
            const provider = providers[cursor++];
            if (provider === undefined) break;
            try {
              const entry = await this.fetch_provider(provider, fetch_signal);
              if (entry !== null) next.providers[provider] = entry;
            } catch (error) {
              if (!fetch_signal.aborted)
                this.log.warning("Pi 模型能力目录供应商检查失败。", {
                  error,
                  context: { provider },
                });
            }
          }
        }),
      );
      clearTimeout(timeout);
      if (controller.signal.aborted) return;
      if (fetch_controller.signal.aborted)
        this.log.warning("Pi 模型能力目录检查超时，保留已完成的供应商结果。");
      const candidate = this.merge(next);
      const serialized = JSON.stringify(next);
      // 缓存经原路径写入，保留用户设置的文件链接。
      if (serialized !== JSON.stringify(this.cache))
        this.native_fs.write_file_sync(this.file_path, serialized);
      if (same_models(candidate, this.models)) {
        this.cache = next;
        return;
      }
      await apply(
        candidate,
        () => {
          if (controller.signal.aborted) throw new Error("Pi catalog update cancelled");
          this.cache = next;
          this.models = candidate;
          this.revision += 1;
        },
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted) this.log.warning("Pi 模型能力目录更新失败。", { error });
    } finally {
      clearTimeout(timeout);
      this.controller = null;
    }
  }

  /** 取消本轮工作，已落盘缓存可在下次启动重新应用。 */
  public dispose(): void {
    this.controller?.abort();
  }

  /** 条件请求只接纳更新的数据，提前结束时释放响应体。 */
  private async fetch_provider(
    provider: string,
    signal: AbortSignal,
  ): Promise<ProviderEntry | null> {
    const old = this.cache.providers[provider];
    const response = await fetch(`${REMOTE_ROOT}${encodeURIComponent(provider)}`, {
      headers: old?.etag
        ? { "If-None-Match": old.etag }
        : old === undefined
          ? {}
          : { "If-Modified-Since": new Date(old.modified).toUTCString() },
      signal,
    });
    if (response.status === 304) return null;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Pi catalog ${provider}: HTTP ${response.status}`);
    }
    const modified = Date.parse(response.headers.get("Last-Modified") ?? "");
    if (!Number.isFinite(modified) || modified <= Math.max(this.generated_at, old?.modified ?? 0)) {
      await response.body?.cancel();
      return null;
    }
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload))
      throw new Error(`Pi catalog ${provider}: invalid provider body`);
    const models = Object.entries(payload).map(([id, value]) =>
      read_catalog_model(provider, id, value),
    );
    if (models.length === 0) throw new Error(`Pi catalog ${provider}: empty provider body`);
    const etag = response.headers.get("ETag");
    return { modified, ...(etag === null ? {} : { etag }), models };
  }

  /** 按当前内置日期筛选缓存，坏供应商条目独立回退。 */
  private read_cache(value: unknown): CatalogCache {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("Invalid Pi catalog cache");
    const source = value as Record<string, unknown>;
    if (
      source.version !== 1 ||
      typeof source.providers !== "object" ||
      source.providers === null ||
      Array.isArray(source.providers)
    )
      throw new Error("Unsupported Pi catalog cache");
    const providers: CatalogCache["providers"] = {};
    for (const [provider, entry] of Object.entries(source.providers)) {
      if (!this.providers.includes(provider) || typeof entry !== "object" || entry === null)
        continue;
      const record = entry as Record<string, unknown>;
      const modified = record.modified;
      if (
        typeof modified !== "number" ||
        !Number.isSafeInteger(modified) ||
        !Array.isArray(record.models) ||
        record.models.length === 0
      ) {
        this.log.warning("Pi 模型能力缓存供应商条目无效。", { context: { provider } });
        continue;
      }
      if (modified <= this.generated_at) continue;
      try {
        providers[provider] = {
          modified,
          ...(typeof record.etag === "string" ? { etag: record.etag } : {}),
          models: record.models.map((model) => {
            const id = (model as { id?: unknown }).id;
            return read_catalog_model(provider, String(id ?? ""), model);
          }),
        };
      } catch (error) {
        this.log.warning("Pi 模型能力缓存供应商条目无效。", { error, context: { provider } });
      }
    }
    return { version: 1, providers };
  }

  /** 同供应商同 ID 的远端条目覆盖基线，其余内置条目继续可用。 */
  private merge(cache: CatalogCache): readonly PiCatalogModel[] {
    const models = new Map(this.builtin.map((model) => [`${model.provider}\0${model.id}`, model]));
    for (const entry of Object.values(cache.providers)) {
      for (const model of entry.models) models.set(`${model.provider}\0${model.id}`, model);
    }
    return [...models.values()];
  }
}

/** 校验能力输入并丢弃无关字段，协议名称只参与模板选择。 */
function read_catalog_model(provider: string, id: string, value: unknown): PiCatalogModel {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Invalid Pi model ${provider}/${id}`);
  const model = value as Record<string, unknown>;
  if (
    !id ||
    model.id !== id ||
    model.provider !== provider ||
    typeof model.api !== "string" ||
    !model.api ||
    typeof model.reasoning !== "boolean" ||
    typeof model.contextWindow !== "number" ||
    !Number.isSafeInteger(model.contextWindow) ||
    model.contextWindow <= 0 ||
    typeof model.maxTokens !== "number" ||
    !Number.isSafeInteger(model.maxTokens) ||
    model.maxTokens <= 0 ||
    (model.thinkingLevelMap !== undefined && !valid_thinking_map(model.thinkingLevelMap)) ||
    (model.compat !== undefined && !valid_compat(model.compat))
  )
    throw new Error(`Invalid Pi model ${provider}/${id}`);
  return {
    id,
    provider,
    api: model.api,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: model.thinkingLevelMap }),
    ...(model.compat === undefined ? {} : { compat: model.compat }),
  };
}

/** 比较能力内容，排序差异和供应商展示元数据不触发更新。 */
function same_models(left: readonly PiCatalogModel[], right: readonly PiCatalogModel[]): boolean {
  const normalize = (models: readonly PiCatalogModel[]) =>
    JSON.stringify(
      models
        .map((model) => ({
          provider: model.provider,
          id: model.id,
          api: model.api,
          reasoning: model.reasoning,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          thinkingLevelMap: stable(model.thinkingLevelMap),
          compat: stable(model.compat),
        }))
        .sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`)),
    );
  return normalize(left) === normalize(right);
}

/** 固定嵌套对象键序，使等价 JSON 得到相同表示。 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]),
  );
}

/** 档位映射会参与请求参数生成，值必须符合 Pi 的公开契约。 */
function valid_thinking_map(value: unknown): value is ThinkingLevelMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const levels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  return Object.entries(value).every(
    ([key, entry]) => levels.has(key) && (entry === null || typeof entry === "string"),
  );
}

/** 约束当前协议消费的开关和枚举，额外字段继续交给 Pi 处理。 */
function valid_compat(value: unknown): value is NonNullable<PiCatalogModel["compat"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entry]) => {
    if (/^(supports|requires|send|zaiToolStream|forceAdaptiveThinking)/u.test(key))
      return typeof entry === "boolean";
    if (key === "cacheControlFormat") return entry === "anthropic";
    if (key === "thinkingFormat")
      return (
        typeof entry === "string" &&
        [
          "openai",
          "openrouter",
          "deepseek",
          "together",
          "baseten",
          "zai",
          "qwen",
          "chat-template",
          "qwen-chat-template",
          "string-thinking",
          "ant-ling",
        ].includes(entry)
      );
    if (key === "maxTokensField")
      return entry === "max_tokens" || entry === "max_completion_tokens";
    if (key === "vllmPriority") return typeof entry === "number" && Number.isFinite(entry);
    return true; // 新 SDK 字段只由 Pi 消费，未知字段由 Pi 自身决定。
  });
}
