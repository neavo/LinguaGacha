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
    clean_ruby: {
      title: "원문의 후리가나 제거",
      description:
        "루비 주석의 독음을 제거하고 본문만 남깁니다. 기본적으로 사용하지 않습니다" +
        "\n" +
        "모델은 루비 주석을 제대로 이해하지 못하는 경우가 많아 제거하면 번역 품질을 높일 수 있습니다. 지원 형식의 예시:" +
        "\n" +
        "• <ruby>漢字<rt>かんじ</rt></ruby>" +
        "\n" +
        "• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]" +
        "\n" +
        "• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]" +
        "\n" +
        '• [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]',
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
    auto_process_prefix_suffix_preserved_text: {
      title: "앞뒤 보호 텍스트 자동 처리",
      description:
        "각 텍스트 항목의 앞뒤에서 보호 규칙에 일치하는 부분을 자동 처리합니다. 기본적으로 사용합니다" +
        "\n" +
        "• 사용하면 앞뒤에서 보호 규칙에 일치하는 부분을 제거하고 번역이 끝난 후 다시 붙입니다" +
        "\n" +
        "• 사용하지 않으면 전체 텍스트 항목을 모델에 전송합니다. 의미를 더 온전히 전달할 수 있지만 텍스트 보호 효과는 낮아집니다",
    },
  },
  feedback: {
    refresh_failed: "전문가 설정을 새로 고칠 수 없습니다. 잠시 후 다시 시도해 주세요.",
    update_failed: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    preceding_lines_threshold_invalid:
      "앞선 문맥의 최대 줄 수에 유효한 범위의 숫자를 입력해 주세요.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
