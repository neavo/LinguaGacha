import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_laboratory_page = {
  title: "Laboratório",
  fields: {
    prompt_enhancement_enable: {
      title: "Aprimoramento de prompt",
      description:
        "Reforça o seguimento de instruções da IA simulando uma cadeia de raciocínio." +
        "\n" +
        "Desativar reduz ligeiramente o consumo de tokens, mas reduz significativamente a inteligência da IA. Ativado por padrão.",
    },
    mtool_optimizer_enable: {
      title: "Otimizador MTool",
      description:
        "Para textos do MTool, <emphasis>reduz o tempo de tradução e os tokens em até 40%</emphasis>. Ativado por padrão.",
    },
    skip_duplicate_source_text_enable: {
      title: "Ignorar texto original duplicado",
      description:
        "Entradas com texto idêntico em todo o projeto compartilham <emphasis>uma única tradução</emphasis>. Ativado por padrão.",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
