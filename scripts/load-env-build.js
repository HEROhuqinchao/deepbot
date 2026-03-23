/**
 * 加载 .env 文件后执行 electron-builder 打包
 * 用途：确保 after-sign.js 能读取到 APPLE_ID 等环境变量
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 加载 .env 文件
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    process.env[key] = value;
  }
  console.log('✅ 已加载 .env 环境变量');
} else {
  console.warn('⚠️  未找到 .env 文件，Apple 公证可能失败');
}

// 获取打包平台参数（--mac / --win / --linux）
const platform = process.argv[2] || '--mac';

// 执行构建和打包
const buildCmd = platform === '--win'
  ? `node scripts/download-node-win.js && pnpm run build && electron-builder ${platform}`
  : `pnpm run build && electron-builder ${platform}`;

console.log(`\n🚀 开始打包: ${buildCmd}\n`);

execSync(buildCmd, { stdio: 'inherit', env: process.env });

// 打包完成后重命名文件为友好名称
const releaseDir = path.join(__dirname, '..', 'release');
const version = require('../package.json').version;

if (platform === '--mac') {
  // x64 → intel，arm64 → silicon
  const renameMap = {
    '-mac-x64.': '-mac-intel.',
    '-mac-arm64.': '-mac-silicon.',
  };
  const files = fs.readdirSync(releaseDir);
  for (const file of files) {
    for (const [from, to] of Object.entries(renameMap)) {
      if (file.includes(from)) {
        const newName = file.replace(from, to);
        fs.renameSync(path.join(releaseDir, file), path.join(releaseDir, newName));
        console.log(`✅ 重命名: ${file} → ${newName}`);
      }
    }
  }
} else if (platform === '--win') {
  // nsis 安装包：DeepBot Terminal-Setup-x.x.x.exe → DeepBot-Terminal-x.x.x-windows.exe
  const setupName = `DeepBot Terminal-Setup-${version}.exe`;
  const targetName = `DeepBot-Terminal-${version}-windows.exe`;
  const setupPath = path.join(releaseDir, setupName);
  if (fs.existsSync(setupPath)) {
    fs.renameSync(setupPath, path.join(releaseDir, targetName));
    console.log(`✅ 重命名: ${setupName} → ${targetName}`);
  }
}
