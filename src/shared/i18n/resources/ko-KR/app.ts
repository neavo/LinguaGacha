import type { zh_cn_app } from "../zh-CN/app";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_app = {
  metadata: {
    app_name: "LinguaGacha",
  },
  model: {
    type: {
      preset: "프리셋 모델",
      google: "사용자 지정 Google 모델",
      openai: "사용자 지정 OpenAI 모델",
      openai_responses: "사용자 지정 OpenAI Responses 모델",
      anthropic: "사용자 지정 Anthropic 모델",
    },
    selection: {
      label: "모델 선택",
      unavailable: "사용 가능한 모델이 없습니다",
      load_failed: "모델 선택을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요 …",
      update_failed: "모델 선택을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요 …",
    },
    thinking_level: {
      label: "생각 수준",
      default: "기본값",
      unsupported: "선택한 모델은 아직 지원하지 않습니다",
      off: "끄기",
      low: "낮음",
      medium: "보통",
      high: "높음",
      xhigh: "매우 높음",
      max: "최대",
    },
  },
  action: {
    add: "추가",
    cancel: "취소",
    confirm: "확인",
    close: "닫기",
    create: "추가",
    delete: "삭제",
    edit: "편집",
    export: "내보내기",
    import: "가져오기",
    preset: "프리셋",
    query: "조회",
    reset: "초기화",
    retry: "다시 시도",
    save: "저장",
    skip: "건너뛰기",
    overwrite: "덮어쓰기",
    replace: "치환",
    go_to_agent: "AGENT로 이동",
    loading: "불러오는 중",
    select_file: "파일 선택",
    select_folder: "폴더 선택",
  },
  feedback: {
    initial_load_failed: "앱 데이터를 불러오지 못했습니다. 다시 시도해 주세요.",
    export_success: "데이터를 내보냈습니다 …",
    import_success: "데이터를 가져왔습니다 …",
    no_valid_data: "유효한 데이터가 없습니다 …",
    update_failed: "업데이트에 실패했습니다 …",
    project_settings_aligned: "현재 설정에 맞춰 프로젝트 설정을 업데이트했습니다 …",
  },
  error_boundary: {
    eyebrow: "Renderer Runtime",
    title: "페이지 실행 중 오류가 발생했습니다",
    description: "현재 창을 보호 화면으로 전환했습니다. 오류 상세 내용은 로그에 기록되었습니다.",
  },
  project_settings_alignment: {
    field: {
      source_language: "입력 언어",
      target_language: "출력 언어",
      mtool_optimizer_enable: "MTool 최적화",
      skip_duplicate_source_text_enable: "중복 원문 건너뛰기",
    },
  },
  close_confirm: {
    description: "앱을 종료할까요?",
  },
  quality_rule_import: {
    duplicate_description: "중복 규칙 {COUNT}개를 발견했습니다. 처리 방법을 선택해 주세요.",
  },
  update: {
    confirm_description: "LinguaGacha v{VERSION} 업데이트가 있습니다. 다운로드할까요?",
    restart_confirm: "다시 시작하여 업데이트",
    launching: "처리 중 …",
  },
  drop: {
    multiple_unavailable: "한 번에 파일 하나만 놓을 수 있습니다",
    unavailable: "놓은 파일의 로컬 경로를 읽을 수 없습니다. 클릭하여 가져와 주세요.",
    import_here: "놓아서 규칙 파일 가져오기",
  },
  toggle: {
    option: {
      disabled: "미사용",
      enabled: "사용",
    },
  },
  state: {
    disabled: "사용 안 함",
    enabled: "사용 중",
  },
  editor: {
    line_wrap_target: "{TARGET} 자동 줄 바꿈",
  },
  tooltip: {
    value: "{TITLE} · {VALUE}",
  },
  drag: {
    enabled: "드래그하여 순서 변경",
    disabled: "드래그 불가",
    handle: "드래그",
  },
  language: {
    ALL: "전체",
    ZH: "중국어",
    "ZH-HANT": "중국어(번체)",
    EN: "영어",
    JA: "일본어",
    KO: "한국어",
    RU: "러시아어",
    AR: "아랍어",
    DE: "독일어",
    FR: "프랑스어",
    PL: "폴란드어",
    ES: "스페인어",
    IT: "이탈리아어",
    PT: "포르투갈어",
    HU: "헝가리어",
    TR: "튀르키예어",
    TH: "태국어",
    ID: "인도네시아어",
    VI: "베트남어",
  },
  navigation_action: {
    appearance: "모양",
    font: "글꼴",
    font_option: {
      lg_base: "LGBase",
      system: "시스템 글꼴",
    },
    theme: "테마",
    theme_option: {
      system: "시스템 설정 따르기",
      light: "밝게",
      dark: "어둡게",
    },
    language: "언어",
    logs: "로그",
  },
  profile: {
    status: "Ciallo～(∠・ω< )⌒✮",
    status_tooltip: "GitHub 프로젝트 페이지 열기",
    update_available: "클릭하여 새 버전 다운로드!",
    update_available_tooltip: "업데이트 확인 창 열기",
  },
  prompt: {
    source: "원문",
    builder_control_character_samples: "제어 문자 예시:",
    builder_glossary_header: "용어집 <원문 용어> -> <번역 용어> #<용어 정보>:",
    builder_input: "입력:",
    builder_preceding_context: "앞선 문맥:",
  },
  translation_export: {
    directory: {
      translated: "번역문",
      bilingual: "번역문_대역",
    },
  },
  native_file_filter: {
    project: "LinguaGacha 프로젝트",
    supported_json_xlsx_files: "지원 파일 (*.json *.xlsx)",
    json_files: "JSON 파일 (*.json)",
    excel_files: "Excel 파일 (*.xlsx)",
    supported_txt_files: "지원 파일 (*.txt)",
  },
  error: {
    request: {
      validation_failed: {
        message: "요청 매개변수가 잘못되었습니다 …",
      },
      invalid_json: {
        message: "요청 JSON이 잘못되었습니다 …",
      },
      route_not_found: {
        message: "API 경로가 없습니다 …",
      },
    },
    project: {
      not_loaded: {
        message: "프로젝트가 열려 있지 않습니다 …",
      },
      not_found: {
        message: "프로젝트 파일이 없습니다 …",
      },
    },
    file: {
      not_found: {
        message: "파일이 없습니다 …",
      },
      parse_failed: {
        message: "파일 내용을 해석하지 못했습니다 …",
      },
      invalid_structure: {
        message: "파일 구조가 형식 요구 사항에 맞지 않습니다 …",
      },
      io_failed: {
        message: "파일 읽기·쓰기에 실패했습니다 …",
      },
    },
    database: {
      conflict: {
        message: "데이터베이스 쓰기 충돌이 발생했습니다. 새로 고친 후 다시 시도해 주세요 …",
      },
    },
    data: {
      revision_conflict: {
        message: "데이터 버전이 변경되었습니다. 새로 고친 후 다시 시도해 주세요 …",
      },
      committed_sync_failed: {
        message: "데이터는 저장되었으나 화면 동기화에 실패했습니다 …",
      },
    },
    model: {
      not_found: {
        message: "모델 설정이 없습니다 …",
      },
      provider_failed: {
        message: "모델 서비스 요청에 실패했습니다. API 설정을 확인해 주세요 …",
      },
    },
    worker: {
      failed: {
        message: "백그라운드 실행 채널에 오류가 발생했습니다 …",
      },
      execution_failed: {
        message: "백그라운드 작업 실행에 실패했습니다 …",
      },
    },
    runtime: {
      busy: {
        message: "모델이 실행 중입니다. 잠시 후 다시 시도해 주세요 …",
      },
      capability_missing: {
        message: "현재 실행 환경에 필요한 기능이 없습니다 …",
      },
      disposed: {
        message: "실행 리소스가 해제되었습니다 …",
      },
      cancelled: {
        message: "작업이 취소되었습니다 …",
      },
      internal_invariant: {
        message: "내부 상태에 오류가 있습니다 …",
      },
    },
    language: {
      invalid_target_language: {
        message: "대상 언어가 잘못되었습니다 …",
      },
      unsupported_all_target_language: {
        message: "대상 언어로 전체 언어를 선택할 수 없습니다 …",
      },
      unknown_source_language_code: {
        message: "원문 언어 코드가 잘못되었습니다 …",
      },
    },
    quality: {
      unknown_rule_type: {
        message: "품질 규칙 유형이 잘못되었습니다 …",
      },
      unsupported_rule_meta: {
        message: "품질 규칙 설정 항목이 잘못되었습니다 …",
      },
    },
    prompt: {
      unknown_prompt_type: {
        message: "프롬프트 유형이 잘못되었습니다 …",
      },
    },
    desktop: {
      missing_backend_api_base_url: {
        message: "Backend API 주소가 설정되지 않았습니다 …",
      },
      http_error: {
        message: "요청 실패: {PATH} …",
      },
      network_failed: {
        message: "네트워크 요청 실패: {PATH} …",
      },
      timeout: {
        message: "요청 시간 초과: {PATH} …",
      },
    },
  },
  diagnostic: {
    agent: {
      model_round_failed: "Agent 모델 턴이 실패했습니다 …",
      context_compaction_failed: "Agent 컨텍스트 압축에 실패했습니다 …",
      session_cleanup_failed: "Agent 세션 정리에 실패했습니다 …",
      tool_execution_failed: "Agent 도구 실행 중 오류가 발생했습니다 …",
      skill_load_failed: "Agent 스킬을 불러오지 못했습니다 …",
      skill_resource_load_failed: "Agent 스킬 리소스를 불러오지 못했습니다 …",
    },
    api_gateway: {
      direct_route_failed: "API Gateway 직접 경로 처리에 실패했습니다 …",
    },
    default_preset: {
      config_normalize_failed: "기본 프리셋 설정을 정규화하지 못했습니다: {CONFIG_PATH} …",
      prompt_load_failed: "기본 프롬프트 프리셋을 불러오지 못했습니다 …",
      quality_rule_load_failed: "기본 품질 규칙 프리셋을 불러오지 못했습니다 …",
      value_normalize_failed:
        "기본 프리셋 값을 정규화하지 못했습니다: {PRESET_DIRECTORY} -> {VALUE} …",
    },
    file_export: {
      open_output_folder_failed: "출력 폴더를 열지 못했습니다 …",
      translation_failed: "번역문 생성에 실패했습니다 …",
      write_file_failed: "파일 쓰기에 실패했습니다 …",
    },
    lifecycle: {
      app_start_failed: "LinguaGacha를 시작하지 못했습니다 …",
      backend_gateway_start_failed: "Backend / Gateway를 시작하지 못했습니다 …",
      main_fatal_uncaught: "Electron main에서 처리되지 않은 치명적 예외가 발생했습니다 …",
    },
    migration: {
      path_failed: "경로 이전에 실패했습니다: {SOURCE_PATH} -> {DESTINATION_PATH} …",
    },
    renderer: {
      main_frame_load_failed: "렌더러 기본 프레임을 불러오지 못했습니다 …",
      process_exited: "렌더러 프로세스가 종료되었습니다 …",
      reported_error: "Renderer에서 프런트엔드 실행 중 오류가 발생했습니다 …",
      subframe_load_failed: "렌더러 하위 프레임을 불러오지 못했습니다 …",
      window_unresponsive: "창이 응답하지 않습니다 …",
    },
  },
  log: {
    api_gateway_started: "API Gateway 시작됨 - {BASE_URL}",
    api_test_fail: "API 테스트에 실패했습니다 …",
    api_test_key: "테스트 중인 키:",
    api_test_messages: "작업 프롬프트:",
    api_test_result: "API {COUNT}개 테스트 완료, 성공 {SUCCESS}개, 실패 {FAILURE}개 …",
    api_test_result_failure: "실패한 키:",
    api_test_response_result: "모델 응답 내용:",
    api_test_timeout: "요청 시간 초과({SECONDS}초)",
    api_test_token_info: "소요 시간 {TIME}초, 입력 {PT} Tokens, 생각 {RT} Tokens, 출력 {CT} Tokens",
    app_version: "LinguaGacha v{VERSION} …",
    default_preset_loaded: "기본 프리셋을 자동으로 불러왔습니다: {NAMES} …",
    engine_api_model: "API 모델",
    engine_api_name: "API 이름",
    engine_api_url: "API 주소",
    engine_task_done: "작업이 완료되었습니다 …",

    engine_task_fail:
      "일부 작업이 완료되지 않았습니다. 미처리 데이터가 있으니 처리 결과를 확인해 주세요 …",
    engine_task_rule_analysis: "규칙 분석:",
    engine_task_thinking_process: "생각 과정:",
    engine_task_stop: "작업이 중지되었습니다 …",
    engine_task_success:
      "소요 시간 {TIME}초, 텍스트 {LINES}줄, 입력 {PT} Tokens, 생각 {RT} Tokens, 출력 {CT} Tokens",
    generate_translation_done: "번역문을 {PATH}에 저장했습니다 …",
    generate_translation_start: "번역문 생성 중 …",
    model_response_invalid: "모델이 반환한 데이터가 유효하지 않습니다 …",
    request_failed: "요청 실패: {ERROR} …",
    request_timeout: "네트워크 요청 시간 초과",
    system_closed_dropped: "로그 시스템이 종료되어 새 로그를 버렸습니다: {MESSAGE}",
    translation_task_result: "번역 결과:",
    translation_response_partially_invalid: "일부 번역문이 검증을 통과하지 못했습니다 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app>;
