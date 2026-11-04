# 区域拼接与标注

以下示例使用 `@lg/pdf/mupdf` 处理已渲染的 PNG，结果通过 `ws.emitImage` 查看。

## 拼接相关区域

先确认区域间的阅读顺序和关联，再拼接。不同页面的裁剪使用一致比例，保留来源页与坐标记录。大量页面拼成一张图会挤压小字的可用像素，按连贯内容分组。

以下示例纵向组合两张已经裁剪好的图片，并保留间隔。总画布超过本次看图尺寸时，优先缩小调查范围。

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from '@lg/pdf/mupdf';
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

MuPDF 的 `zh-Hans` 字体可绘制简体中文。按实际文字检查缺字、尺寸和换行，文字布局由脚本明确安排。

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from '@lg/pdf/mupdf';
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
