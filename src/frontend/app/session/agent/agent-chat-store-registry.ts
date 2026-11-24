import type { ChatScope } from "@frontend/app/desktop/scoped-api";
import { AgentChatStore } from "./agent-chat-store";

/** 打开的对话保有草稿和订阅，挂载哪个对话由工作区决定。 */
export class AgentChatStoreRegistry {
  private readonly stores = new Map<string, AgentChatStore>();
  private readonly connected = new Set<AgentChatStore>();

  private readonly on_error: ConstructorParameters<typeof AgentChatStore>[1];

  constructor(on_error: ConstructorParameters<typeof AgentChatStore>[1]) {
    this.on_error = on_error;
  }

  /** 渲染期间只取得 Store，网络订阅由 effect 建立。 */
  public get(scope: ChatScope): AgentChatStore {
    const key = `${scope.projectId}:${scope.chatId}`; // 重开工程时沿用 `chatId`，但传输使用新的 `projectId`。
    const previous = this.stores.get(key);
    if (previous) return previous;
    const store = new AgentChatStore(window.localStorage, this.on_error, scope);
    this.stores.set(key, store);
    return store;
  }

  /** 关闭工程或删除对话时回收对应镜像，后台对话继续订阅。 */
  public retain(stores: readonly AgentChatStore[]): void {
    const retained = new Set(stores);
    for (const [key, store] of this.stores) {
      if (retained.has(store)) continue;
      store.get_input().draft.cancel_uploads();
      store.disconnect();
      this.connected.delete(store);
      this.stores.delete(key);
    }
    for (const store of stores) {
      if (this.connected.has(store)) continue;
      this.connected.add(store);
      store.connect();
    }
  }

  /** effect 清理只断开订阅，StrictMode 重挂载时复用原草稿。 */
  public disconnect(): void {
    for (const store of this.connected) store.disconnect();
    this.connected.clear();
  }
}
