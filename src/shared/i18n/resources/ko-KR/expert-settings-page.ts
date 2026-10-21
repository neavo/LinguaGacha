import type { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_expert_settings_page = {
  title: "전문가 설정",
  fields: {
    preceding_lines_threshold: {
      title: "참고할 앞선 문맥의 최대 줄 수",
      description:
        "각 번역 작업에 포함할 수 있는 앞선 문맥의 최대 줄 수입니다. 기본적으로 사용하지 않습니다",
    },
    deduplication_in_bilingual: {
      title: "대역 파일에서 원문과 번역문이 같으면 한 번만 출력",
      description:
        "자막과 전자책에서 원문과 번역문이 같으면 한 번만 출력합니다. 기본적으로 사용합니다",
    },
    write_translated_name_fields_to_file: {
      title: "이름 필드의 번역문을 출력 파일에 쓰기",
      description:
        "일부 <emphasis>GalGame</emphasis>의 이름 필드는 이미지·음성 파일과 연결됩니다. 이름 번역 시 오류가 나면 끄세요. 기본값은 사용입니다." +
        "\n" +
        "지원 형식:" +
        "\n" +
        "• RenPy에서 내보낸 게임 텍스트(.rpy)" +
        "\n" +
        "• VNTextPatch 또는 SExtractor에서 내보낸 name 필드가 있는 게임 텍스트(.json)",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "앞선 문맥의 최대 줄 수에 유효한 범위의 숫자를 입력해 주세요 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
