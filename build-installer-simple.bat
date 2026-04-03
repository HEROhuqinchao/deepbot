@echo off
chcp 65001 >nul
echo ======================================
echo 史丽慧小助理 Windows 安装包打包工具
echo ======================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo 请求管理员权限...
    powershell -Command "Start-Process cmd -ArgumentList '/c', 'cd /d %%~dp0 && %%~nx0' -Verb RunAs"
    goto :eof
)

echo [1/5] 正在安装依赖...
call pnpm install
if %errorLevel% neq 0 (
    echo ❌ 依赖安装失败！
    pause
    exit /b 1
)
echo ✅ 依赖安装完成
echo.

echo [2/5] 正在下载 Node.js 可执行文件...
node scripts/download-node-win.js
if %errorLevel% neq 0 (
    echo ❌ Node.js 下载失败！
    pause
    exit /b 1
)
echo ✅ Node.js 下载完成
echo.

echo [3/5] 正在编译项目...
call pnpm run build
if %errorLevel% neq 0 (
    echo ❌ 编译失败！
    pause
    exit /b 1
)
echo ✅ 编译完成
echo.

echo [4/5] 正在清理旧的构建文件...
if exist release\win-unpacked (
    rmdir /s /q release\win-unpacked
)
echo ✅ 清理完成
echo.

echo [5/5] 正在创建 NSIS 安装包...
echo 注意：此过程可能会遇到符号链接警告，可以忽略
echo.
call npx electron-builder --win nsis --x64 --publish=never
if %errorLevel% neq 0 (
    echo.
    echo ⚠️  打包过程中出现警告，但可能已生成安装包
    echo.
)

echo.
echo ======================================
echo 打包完成！
echo ======================================
echo.
if exist release\史丽慧小助理-Terminal-Setup-*.exe (
    echo ✅ 安装包位置:
    dir /b release\史丽慧小助理-Terminal-Setup-*.exe | findstr /v ".blockmap"
    echo.
    echo 📦 文件大小:
    for %%f in (release\史丽慧小助理-Terminal-Setup-*.exe) do @echo   - %%~zf bytes
) else (
    echo ⚠️  未找到安装包，请检查错误信息
    echo.
    echo 💡 你可以使用已解压的版本:
    echo   release\win-unpacked\史丽慧小助理 Terminal.exe
)
echo.
echo ======================================
pause
