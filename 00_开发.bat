@echo off
@chcp 65001 > nul

@REM 设置工作目录
cd /d %~dp0

@REM 设置临时 PATH
@REM set PATH=%~dp0\resource;%PATH%

@REM 启动应用
call python.exe app.py