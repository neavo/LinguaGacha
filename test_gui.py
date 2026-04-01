import sys
from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt

print("Step 1: Creating QApplication...")
QApplication.setHighDpiScaleFactorRoundingPolicy(
    Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
)
app = QApplication(sys.argv)
print("Step 2: QApplication created")

print("Step 3: Importing AppFluentWindow...")
from frontend.AppFluentWindow import AppFluentWindow
print("Step 4: Import successful")

print("Step 5: Creating window...")
window = AppFluentWindow()
print("Step 6: Window created")

print("Step 7: Showing window...")
window.show()
print("Step 8: Window shown")

print("Step 9: Entering event loop...")
sys.exit(app.exec())
