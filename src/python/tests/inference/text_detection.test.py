import numpy as np

from lg.inference import text_detection


prediction = np.zeros((32, 32), np.float32)
prediction[10:22, 12:20] = 1
records = text_detection.det_box_records(prediction, 64, 64)

assert len(records) == 1
record = records[0]
assert 0.5 <= record["score"] <= 1
assert np.all(record["coreBox"][:, 0] >= record["box"][:, 0].min())
assert np.all(record["coreBox"][:, 0] <= record["box"][:, 0].max())
assert np.all(record["coreBox"][:, 1] >= record["box"][:, 1].min())
assert np.all(record["coreBox"][:, 1] <= record["box"][:, 1].max())
assert np.array_equal(text_detection.det_boxes(prediction, 64, 64)[0], record["box"])

assert len(
    text_detection.det_box_records(
        prediction * 0.4,
        64,
        64,
        threshold=0.15,
        box_threshold=0.25,
        unclip_ratio=1.4,
    )
) == 1
