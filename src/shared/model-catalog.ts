/** GUI Backend 实例内单调递增；启动时间用于丢弃旧实例迟到的网络结果。 */
export type ModelCatalogSnapshot = Readonly<{
  instance_id: string;
  started_at: number; // 以微秒表示启动时间，用于区分旧实例的迟到结果。
  revision: number;
}>;

export const MODEL_CATALOG_UPDATED_EVENT_TOPIC = "model_catalog.updated";
