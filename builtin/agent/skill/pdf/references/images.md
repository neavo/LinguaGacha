# PDF 图片操作

按当前问题选择示例并替换文件、页码和区域。使用预装 `mupdf` 和 `@lg/pdf`，输出 PNG。程序生成图片后通过 `ws.emitImage` 查看，再根据实际结果调整区域或文字。

## 裁剪与细节

先查看整页，再确定区域。坐标使用旋转后的原页左上角，单位与 `scale=1` 一致。所选区域保留完整表格行、图例和图注。放大图像不会恢复原稿中缺失的细节。

以下代码假定 `document` 是已打开的原稿，由调用者在整组操作结束后释放。

```js
import { writeFile } from 'node:fs/promises';
import { render_pdf_page } from '@lg/pdf';
const region = { page: 1, x: 40, y: 80, width: 400, height: 240 };
const maxEdge = 3840;
await writeFile('work/detail.png', render_pdf_page(document, {
  page: region.page,
  region,
  scale: maxEdge / Math.max(region.width, region.height),
}));
await ws.emitImage('work/detail.png', { maxEdge });
```

整页概览使用默认尺寸。密集小字优先裁剪，仍需细节时提高单次 `maxEdge`。渲染与发送使用相同目标最长边，查看返回的实际图片尺寸确认是否发生进一步缩小。

## 拼接相关区域

先确认区域间的阅读顺序和关联，再拼接。不同页面的裁剪使用一致比例，保留来源页与坐标记录。大量页面拼成一张图会挤压小字的可用像素，按连贯内容分组。

以下示例纵向组合两张已经裁剪好的图片，并保留间隔。总画布超过本次看图尺寸时，优先缩小调查范围。

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
const images = [];
try {
  for (const file of ['work/region-1.png', 'work/region-2.png']) {
    images.push(new mupdf.Image(new Uint8Array(await readFile(file))));
  }
  const gap = 24;
  const width = Math.max(...images.map(image => image.getWidth()));
  const height = images.reduce((sum, image) => sum + image.getHeight(), 0) + gap;
  const pixels = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  try {
    pixels.clear(255);
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixels);
    try {
      let y = 0;
      for (const image of images) {
        device.fillImage(image, [image.getWidth(), 0, 0, image.getHeight(), 0, y], 1);
        y += image.getHeight() + gap;
      }
      device.close();
    } finally { device.destroy(); }
    await writeFile('work/joined.png', pixels.asPNG());
  } finally { pixels.destroy(); }
} finally {
  for (const image of images) image.destroy();
}
await ws.emitImage('work/joined.png', { maxEdge: 3840 });
```

## 区域标注与中文文字

标注用于定位检查证据。文字放在内容外的空白带，框线避开待读文字。保留原始图片，修改工作副本。

MuPDF 的 `zh-Hans` 字体可绘制简体中文。按实际文字检查缺字、尺寸和换行，文字布局由脚本明确安排。项目打印宿主加载的 WOFF2 字体属于另一条渲染路径。

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
const image = new mupdf.Image(new Uint8Array(await readFile('work/detail.png')));
try {
  const header = 80;
  const pixels = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB,
    [0, 0, image.getWidth(), image.getHeight() + header], false);
  try {
    pixels.clear(255);
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixels);
    try {
      device.fillImage(image, [image.getWidth(), 0, 0, image.getHeight(), 0, header], 1);
      const font = new mupdf.Font('zh-Hans');
      try {
        const text = new mupdf.Text();
        try {
          text.showString(font, [28, 0, 0, -28, 16, 48], '检查区域：核对图例与单位');
          device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, 0, 0], 1);
        } finally { text.destroy(); }
      } finally { font.destroy(); }
      const outline = new mupdf.Path();
      const stroke = new mupdf.StrokeState({
        lineWidth: 2, lineCap: 'Butt', lineJoin: 'Miter', miterLimit: 10,
      });
      try {
        outline.rect(10, header + 10, image.getWidth() - 10, header + image.getHeight() - 10);
        device.strokePath(outline, stroke, mupdf.Matrix.identity,
          mupdf.ColorSpace.DeviceRGB, [0.85, 0.15, 0.1], 1);
      } finally { stroke.destroy(); outline.destroy(); }
      device.close();
    } finally { device.destroy(); }
    await writeFile('work/annotated.png', pixels.asPNG());
  } finally { pixels.destroy(); }
} finally { image.destroy(); }
await ws.emitImage('work/annotated.png', { maxEdge: 3840 });
```

亮度、伽马或颜色调整只用于辅助观察，数值、图例和颜色语义仍与原图核对。工作图片的标注与文字图层服务于分析，正式译稿插图通过 `pdf-image:` 引用原稿区域。
