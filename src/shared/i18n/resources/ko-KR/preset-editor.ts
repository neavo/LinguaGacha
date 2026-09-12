import type { zh_cn_preset_editor } from "../zh-CN/preset-editor";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_preset_editor = {
  action: {
    apply: "가져오기",
    cancel_default: "기본 프리셋 해제",
    delete: "프리셋 삭제",
    rename: "이름 변경",
    save: "프리셋 저장",
    set_default: "기본 프리셋으로 설정",
  },
  confirm: {
    delete: {
      description: "프리셋을 삭제할까요?",
    },
    overwrite: {
      description: "프리셋을 덮어쓸까요?",
    },
  },
  dialog: {
    name_placeholder: "프리셋 이름 입력 …",
  },
  feedback: {
    exists: "파일이 이미 있습니다 …",
    name_required: "프리셋 이름은 비워 둘 수 없습니다",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
