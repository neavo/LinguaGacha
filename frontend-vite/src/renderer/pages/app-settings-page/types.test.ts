import assert from 'node:assert/strict'
import test from 'node:test'

import {
  build_app_settings_snapshot,
  create_app_settings_pending_state,
} from './types.ts'

test('build_app_settings_snapshot 会裁剪应用设置页依赖的字段', () => {
  const settings_snapshot = {
    expert_mode: true,
    source_language: 'JA',
    target_language: 'ZH',
    project_save_mode: 'MANUAL',
    project_fixed_path: '',
    output_folder_open_on_finish: true,
    request_timeout: 60,
    preceding_lines_threshold: 0,
    clean_ruby: false,
    deduplication_in_trans: true,
    deduplication_in_bilingual: true,
    check_kana_residue: true,
    check_hangeul_residue: true,
    check_similarity: true,
    write_translated_name_fields_to_file: true,
    auto_process_prefix_suffix_preserved_text: true,
    recent_projects: [],
  } satisfies Parameters<typeof build_app_settings_snapshot>[0]

  assert.deepEqual(build_app_settings_snapshot(settings_snapshot), {
    expert_mode: true,
  })
})

test('create_app_settings_pending_state 默认关闭所有提交锁', () => {
  assert.deepEqual(create_app_settings_pending_state(), {
    expert_mode: false,
  })
})
