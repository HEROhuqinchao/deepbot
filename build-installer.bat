@echo off
:: 以管理员权限运行 electron-builder
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo 请求管理员权限...
    powershell -Command "Start-Process cmd -ArgumentList '/c', 'cd /d %~dp0 && pnpm run dist:win' -Verb RunAs"
    goto :eof
)

:: 已经是管理员权限，直接执行
echo 正在创建 Windows 安装包...
set PATH=%PATH%;C:\Program Files\nodejs
pnpm install
node scripts/download-node-win.js
pnpm run build
npx electron-builder --win --x64
pause
