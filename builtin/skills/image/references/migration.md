# 已有 `.image` 资产维护与旧包迁移

## 1. 准备可编辑目录

维护或迁移已有 `.image` 资产前，先加载图片技能的 `image` 模块，将包成员准备到 `work/` 下的**全新**目录 `<dir>/package`：

- **工程内已有资产**：`sources/<asset>` 已按 ZIP 成员展开为只读目录，直接复制到 `<dir>/package`。
- **外部 `.image` 归档文件**：调用 `image.unpack(source, directory)` 安全展开到 `<dir>/package`。

```js
import { cp, mkdir, stat } from 'node:fs/promises';

const source = 'sources/book.image';
const directory = 'work/image/maintain';

if ((await stat(source)).isDirectory()) {
  await mkdir(directory, { recursive: true });
  await cp(source, `${directory}/package`, { recursive: true });
} else {
  await image.unpack(source, directory);
}
```

## 2. 常规维护（当前契约资产）

准备好 `directory` 后，通过 `const { book, records } = image.read(directory)` 读取清单，并按需执行维护：

- **修正原文**：编辑 `${directory}/package/items.json` 中的 `message`，调用 `image.pack(directory, output)` 重新封包，再按 `files.replaces` 提交替换。
- **跨对话调整版式或字号**：直接对该 `directory` 调用主技能中的 `splitBubble`、`mergeBubble` 或 `setFontSizes`，封包后按 `files.replaces` 提交。
- **补识别漏字**：原图确有漏识别文字且包内无对应条目时，从原图重新扫描与准备。
- **重建无框外框**：需要采用新的无框文字外框几何时，基于原图重新准备（不传 `update`）并按 `files.replaces` 替换；带 `{ update, device }` 的 `prepareAndPack` 会沿用包内已有掩码，仅用于补做消字。

## 3. 迁移旧版消字补丁（缺少 `patch.mask`）

- **适用特征**：旧版 `.image` 中，`image.json` 的非空 `region.patch` 仅有 `{ path, box }` 而缺少 `mask`，按当前契约无法直接读取或导入。
- **无损原理**：旧版原图均为不透明图，旧补丁 PNG 的二值 alpha 通道即为精确覆盖掩码；将其拆存为 8-bit 灰度图 `patch-masks/<pageId>/<regionId>.png` 并将补丁 alpha 置为 `255`，即可无损保留消字结果、原图字节与条目身份。

### 在工作区转换

完成第 1 节目录准备后，将下方 Python 脚本保存为 `work/migrate-image-patches.py` 并运行（脚本拒绝已含 `mask` 的补丁，避免重复执行破坏掩码）：

```js
import { uv } from '@lg/uv';

await uv.run(['add', ...image.PIP_DEPENDENCIES.filter((value) => value.startsWith('pillow=='))]);
await uv.run(['run', 'python', '-I', '-B', '-X', 'utf8', 'work/migrate-image-patches.py', `${directory}/package`]);
console.log(await image.pack(directory, 'work/migrated.image'));
```

```python
import json
import re
import sys
from pathlib import Path

from PIL import Image

root = Path(sys.argv[1])
manifest = root / "image.json"
book = json.loads(manifest.read_text(encoding="utf-8"))

for page in book["pages"]:
    for region in page["regions"]:
        patch = region["patch"]
        if patch is None:
            continue
        if "mask" in patch:
            raise ValueError(f"Patch already migrated: {page['pageId']}/{region['regionId']}")
        name = f"{page['pageId']}/{region['regionId']}.png"
        if not re.fullmatch(r"[\w-]+/[\w-]+\.png", name, re.ASCII):
            raise ValueError(f"Invalid patch member: {name}")

        patch_file = root / "patches" / name
        with Image.open(patch_file, formats=["PNG"]) as source:
            mask = source.getchannel("A")
            if any(mask.histogram()[1:255]):
                raise ValueError(f"Non-binary legacy alpha: {name}")
            pixels = source.copy()
        pixels.putalpha(255)

        patch["mask"] = f"patch-masks/{name}"
        mask_file = root / patch["mask"]
        mask_file.parent.mkdir(parents=True, exist_ok=True)
        mask.save(mask_file)
        pixels.save(patch_file)

manifest.write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
```

### 继承译文并切换资产

1. 按 `project-operation` 的「方式二：新增对照后切换」提交 `files.creates`（目标为 `work/migrated.image`）并设 `inheritance_mode: "inherit"`，自动继承旧资产的全部已译条目。
2. 核对新资产的原文、继承译文及出图结果无误后，删除旧资产并将新资产恢复原 `file_path` 与 `sort`。

> [!WARNING]
> 不得对跨契约旧包使用 `files.replaces` 继承译文：替换继承会按当前契约解析工程中的旧包，会因缺少 `patch.mask` 直接失败。
