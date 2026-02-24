/**
 * Browser Control Server
 * 
 * 职责：
 * - 启动 HTTP 服务器
 * - 管理浏览器生命周期
 * - 提供 REST API 控制浏览器
 * 
 * 
 * 简化版本（MVP）：
 * - 只支持一个 Profile
 * - 不支持 Chrome Extension
 * - 不支持远程节点
 * 
 * 重构说明：
 * - 拆分为多个文件，提高可维护性
 * - 将路由处理器按功能分组
 * - 保持接口不变
 */

import type { Server } from 'node:http';
import express from 'express';
import type { Express } from 'express';
import { resolveBrowserConfig } from '../config';
import { DEFAULT_PROFILE_NAME } from '../constants';
import { closeBrowser } from '../pw-session';
import type { BrowserServerState } from './types';
import { registerRoutes } from './routes';

/**
 * 全局状态
 */
let state: BrowserServerState | null = null;

/**
 * 启动中的 Promise（防止并发启动）
 */
let startingPromise: Promise<BrowserServerState | null> | null = null;

/**
 * 启动 Browser Control Server
 * 
 * @returns Server 状态，如果启动失败返回 null
 */
export async function startBrowserControlServer(): Promise<BrowserServerState | null> {
  console.log('[Browser Server] 🔍 startBrowserControlServer 被调用');
  
  // 如果已经启动，直接返回
  if (state) {
    console.log('[Browser Server] 服务器已启动，直接返回');
    return state;
  }

  // 如果正在启动中，等待启动完成
  if (startingPromise) {
    console.log('[Browser Server] 服务器正在启动中，等待完成...');
    return startingPromise;
  }

  console.log('[Browser Server] 创建启动 Promise');
  
  // 创建启动 Promise
  startingPromise = (async () => {
    try {
      return await doStartServer();
    } finally {
      startingPromise = null;
    }
  })();

  return startingPromise;
}

/**
 * 实际启动服务器的函数
 */
async function doStartServer(): Promise<BrowserServerState | null> {
  console.log('[Browser Server] 🚀 doStartServer 开始执行');
  
  // 再次检查（双重检查锁定）
  if (state) {
    console.log('[Browser Server] 双重检查：服务器已启动');
    return state;
  }

  const config = resolveBrowserConfig();
  
  if (!config.enabled) {
    console.log('[Browser Server] 浏览器控制已禁用');
    return null;
  }

  // 创建 Express 应用
  const app: Express = express();
  app.use(express.json({ limit: '1mb' }));

  const port = config.controlPort;

  // 启动服务器
  const server = await new Promise<Server | null>((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => {
      console.log(`[Browser Server] ✅ 服务器启动成功: http://127.0.0.1:${port}/`);
      s.removeAllListeners('error'); // 移除错误监听器
      resolve(s);
    });
    s.once('error', (err) => {
      console.error(`[Browser Server] ❌ 服务器启动失败: ${err}`);
      reject(err);
    });
  }).catch((err) => {
    console.error(`[Browser Server] 捕获到启动错误: ${err}`);
    return null;
  });

  if (!server) {
    return null;
  }

  // 初始化状态
  const profile = {
    name: DEFAULT_PROFILE_NAME,
    cdpPort: config.cdpPort,
    color: config.color,
  };
  
  state = {
    server,
    port,
    profile,
    browser: {
      running: false,
      pid: null,
    },
  };

  // 注册路由
  registerRoutes(app, state);

  return state;
}

/**
 * 停止 Browser Control Server
 */
export async function stopBrowserControlServer(): Promise<void> {
  if (!state) {
    console.log('[Browser Server] 服务器未启动');
    return;
  }

  console.log('[Browser Server] 正在停止服务器...');

  // 停止浏览器（如果正在运行）
  if (state.browser.running) {
    console.log('[Browser Server] 正在停止浏览器...');
    await closeBrowser();
  }

  // 关闭服务器
  await new Promise<void>((resolve) => {
    state?.server.close(() => {
      console.log('[Browser Server] ✅ 服务器已停止');
      resolve();
    });
  });

  state = null;
}

/**
 * 获取当前服务器状态
 * 
 * @returns Server 状态，如果未启动返回 null
 */
export function getBrowserServerState(): BrowserServerState | null {
  return state;
}
