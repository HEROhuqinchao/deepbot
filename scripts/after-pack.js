/**
 * electron-builder afterPack 钩子
 * 打包完成、签名之前执行
 * 在此创建 node 包装脚本，确保它被纳入签名范围
 */

const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  // 只在 macOS 平台执行
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = context.appOutDir + '/' + context.packager.appInfo.productFilename + '.app';
  const appDir = path.join(appPath, 'Contents', 'Resources', 'app');
  const nodeWrapperPath = path.join(appDir, 'node');

  console.log('\n🔗 签名前创建 node 包装脚本...');

  if (!fs.existsSync(appDir)) {
    console.error('❌ app 目录不存在:', appDir);
    return;
  }

  // 删除旧文件
  if (fs.existsSync(nodeWrapperPath)) {
    fs.unlinkSync(nodeWrapperPath);
  }

  // 创建包装脚本，使用 ELECTRON_RUN_AS_NODE 模式运行
  const productName = context.packager.appInfo.productFilename;
  const wrapperScript = `#!/bin/bash
# Node.js wrapper for agent-browser
# 使用 Electron 内置的 Node.js 运行脚本（ELECTRON_RUN_AS_NODE 模式）
export ELECTRON_RUN_AS_NODE=1
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
ELECTRON_PATH="$SCRIPT_DIR/../../MacOS/${productName}"
exec "$ELECTRON_PATH" "$@"
`;

  fs.writeFileSync(nodeWrapperPath, wrapperScript, { mode: 0o755 });
  console.log('✅ node 包装脚本创建成功（将被纳入签名）\n');
};
