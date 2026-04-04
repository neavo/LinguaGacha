import type { WorkbenchFileEntry, WorkbenchMockSeed } from '@/pages/workbench-page/types'

const workbench_file_entries: WorkbenchFileEntry[] = [
  {
    id: 'sample-01',
    rel_path: 'sample_01.txt',
    original_rel_path: 'sample_01.txt',
    file_type: 'TXT',
    format_label_key: 'task.page.workbench.format.text_file',
    format_fallback_label: null,
    item_count: 91,
    original_item_count: 91,
  },
  {
    id: 'sample-02',
    rel_path: 'sample_02.txt',
    original_rel_path: 'sample_02.txt',
    file_type: 'TXT',
    format_label_key: 'task.page.workbench.format.text_file',
    format_fallback_label: null,
    item_count: 68,
    original_item_count: 68,
  },
  {
    id: 'sample-03',
    rel_path: 'sample_03.txt',
    original_rel_path: 'sample_03.txt',
    file_type: 'TXT',
    format_label_key: 'task.page.workbench.format.text_file',
    format_fallback_label: null,
    item_count: 78,
    original_item_count: 78,
  },
]

export const workbench_page_mock: WorkbenchMockSeed = {
  supported_extensions: ['.txt', '.md', '.srt', '.ass', '.epub', '.xlsx'],
  project_loaded: true,
  engine_busy: false,
  task_snapshot: {
    task_type: 'idle',
    status: 'IDLE',
    processed_line: 0,
  },
  workbench_snapshot: {
    file_count: 3,
    total_items: 237,
    translated: 0,
    translated_in_past: 0,
    file_op_running: false,
    entries: workbench_file_entries,
  },
}
