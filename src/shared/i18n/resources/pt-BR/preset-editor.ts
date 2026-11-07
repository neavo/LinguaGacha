import { zh_cn_preset_editor } from "../zh-CN/preset-editor";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_preset_editor = {
  action: {
    apply: "Importar",
    cancel_default: "Cancelar predefinição padrão",
    delete: "Excluir predefinição",
    rename: "Renomear",
    save: "Salvar predefinição",
    set_default: "Definir como predefinição padrão",
  },
  confirm: {
    delete: {
      description: "Confirma a exclusão da predefinição …?",
    },
    overwrite: {
      description: "Confirma a substituição da predefinição …?",
    },
  },
  dialog: {
    name_placeholder: "Digite o nome da predefinição …",
  },
  feedback: {
    exists: "O arquivo já existe",
    name_required: "O nome da predefinição é obrigatório",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
