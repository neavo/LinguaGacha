@echo off

@REM 设置工作目录
set ROOT=%~dp0

@REM 安装依赖
pip install -U -r requirements.txt

pause