import { read_builtin_pi_models, type PiModelCatalogReader } from "../backend/llm/pi-model-catalog";
import { create_pi_model_index, type PiCatalogModel } from "../backend/llm/pi-model-index";

export function create_pi_model_catalog_fixture(
  models: readonly PiCatalogModel[] = read_builtin_pi_models(),
): PiModelCatalogReader {
  const index = create_pi_model_index(models);
  return { read: () => index };
}
