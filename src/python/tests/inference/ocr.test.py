import numpy as np

from lg.inference import ocr


prediction = np.zeros((32, 32), np.float32)
prediction[10:22, 12:20] = 1
records = ocr.image_detection_records(prediction, 64, 64)

assert len(records) == 1
record = records[0]
assert np.all(record["coreBox"] >= record["box"].min(axis=0))
assert np.all(record["coreBox"] <= record["box"].max(axis=0))
media_boxes = ocr.media_detection_boxes(prediction, 64, 64)
assert len(media_boxes) == 1 and media_boxes[0].shape == (4, 2)
assert len(ocr.image_detection_records(prediction * 0.4, 64, 64)) == 1
assert ocr.media_detection_boxes(prediction * 0.4, 64, 64) == []

media = ocr.media_detection_input(np.zeros((1080, 1920, 3), np.uint8))
assert media.shape == (1, 3, 352, 640)

page = ocr.image_detection_input(np.zeros((100, 1000, 3), np.uint8))
assert page.shape == (1, 3, 96, 992)

recognition = ocr.recognition_input(np.full((20, 1000, 3), 255, np.uint8))
assert recognition.shape == (1, 3, 48, 2400)
