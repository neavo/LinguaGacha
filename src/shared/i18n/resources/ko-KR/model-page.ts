import type { zh_cn_model_page } from "../zh-CN/model-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_model_page = {
  title: "모델 관리",
  category: {
    preset: {
      description: "앱에 내장된 프리셋 모델",
    },
    custom_google: {
      description: "Google Gemini API 형식과 호환되는 사용자 지정 모델",
    },
    custom_openai: {
      description: "OpenAI API 형식과 호환되는 사용자 지정 모델",
    },
    custom_openai_responses: {
      description: "OpenAI Responses API 형식과 호환되는 사용자 지정 모델",
    },
    custom_anthropic: {
      description: "Anthropic Claude API 형식과 호환되는 사용자 지정 모델",
    },
  },
  action: {
    basic_settings: "기본 설정",
    task_settings: "작업 설정",
    advanced_settings: "고급 설정",
    input: "입력",
    fetch: "가져오기",
    test: "테스트",
  },
  dialog: {
    selector: {
      loading: "모델 목록 가져오는 중 …",
      search_placeholder: "모델 필터링 …",
      empty: "유효한 데이터가 없습니다 …",
    },
  },
  confirm: {
    delete: {
      description: "모델을 삭제할까요?",
    },
    reset: {
      description: "모델을 초기화할까요?",
    },
  },
  feedback: {
    refresh_failed: "모델 정보를 새로 고치지 못했습니다. 잠시 후 다시 시도해 주세요 …",
    add_failed: "모델을 추가하지 못했습니다. 잠시 후 다시 시도해 주세요 …",
    update_failed: "모델 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요 …",
    reorder_failed: "모델 순서를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요 …",
    delete_last_one: "각 분류에는 모델이 하나 이상 있어야 하므로 삭제할 수 없습니다 …",
    agent_limits_adjusted: "설정값이 잘못되어 사용 가능한 값으로 자동 조정했습니다 …",
    json_format_error: "JSON 형식이 잘못되었습니다. 유효한 JSON 객체를 입력해 주세요 …",
    selector_load_failed: "모델 목록을 가져오지 못했습니다. API 설정을 확인해 주세요 …",
    test_failed: "모델 테스트에 실패했습니다. 잠시 후 다시 시도해 주세요 …",
  },
  fields: {
    context_window: {
      title: "컨텍스트 창",
      description: "AGENT 작업에만 적용, 0 = 자동",
    },
    max_output_tokens: {
      title: "최대 출력 길이",
      description: "AGENT 작업에만 적용, 0 = 자동",
    },
    name: {
      title: "모델 이름",
      description: "앱에 표시할 모델 이름을 입력하세요. 실제 동작에는 영향을 주지 않습니다",
      placeholder: "모델 이름 입력 …",
    },
    api_url: {
      title: "API 주소",
      description: "API 주소를 입력하세요. 끝에 /v1이 필요한지 확인해 주세요",
      placeholder: "API 주소 입력 …",
    },
    api_key: {
      title: "API 키",
      description:
        "API 키(예: sk-d0daba12345678fd8eb7b8d31c123456)를 입력하세요. 여러 키를 한 줄에 하나씩 입력하면 번갈아 사용합니다",
      placeholder: "API 키 입력 …",
    },
    model_id: {
      title: "모델 ID",
      description: "현재 모델 ID는 {MODEL}입니다",
      placeholder: "모델 ID 입력 …",
    },
    thinking: {
      title: "생각 수준",
      description: "모델의 생각 동작을 설정합니다. 생각 시간과 사용량에 영향을 줍니다",
    },
    input_token_limit: {
      title: "입력 Token 제한",
      description: "작업별 입력 텍스트의 최대 Token 수",
    },
    output_token_limit: {
      title: "출력 Token 제한",
      description: "작업별 출력 텍스트의 최대 Token 수, 0 = 자동",
    },
    rpm_limit: {
      title: "분당 요청 수 제한(RPM)",
      description: "이 모델의 분당 요청 수를 제한합니다. 0 = 자동",
    },
    concurrency_limit: {
      title: "동시 작업 수 제한",
      description: "이 모델에서 동시에 실행할 작업 수를 제한합니다. 0 = 자동",
    },
    top_p: {
      title: "top_p",
      description:
        "신중하게 설정하세요. 잘못된 값은 비정상적인 결과나 요청 오류를 일으킬 수 있습니다",
    },
    temperature: {
      title: "temperature",
      description:
        "신중하게 설정하세요. 잘못된 값은 비정상적인 결과나 요청 오류를 일으킬 수 있습니다",
    },
    extra_headers: {
      title: "사용자 지정 요청 헤더",
      description:
        "요청 헤더 매개변수를 설정합니다. 잘못된 값은 비정상적인 결과나 요청 오류를 일으킬 수 있습니다",
      placeholder: '예: {"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: "사용자 지정 요청 본문",
      description:
        "요청 본문 매개변수를 설정합니다. 잘못된 값은 비정상적인 결과나 요청 오류를 일으킬 수 있습니다",
      placeholder: '예: {"seed": 42}',
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_model_page>;
