/**
 * 连接器工具（插件）
 * 
 * 允许 Agent 通过连接器发送图片和文件到外部平台（如飞书）
 * 
 * 注意：此工具仅在连接器会话中可用
 */

import { Type } from '@sinclair/typebox';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { existsSync, statSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { expandUserPath } from '../../shared/utils/path-utils';
import type { Gateway } from '../gateway';
import { TOOL_NAMES } from './tool-names';

let gatewayInstance: Gateway | null = null;
let currentSessionId: string | null = null;

/**
 * 设置 Gateway 实例
 */
export function setGatewayForConnectorTool(gateway: Gateway): void {
  gatewayInstance = gateway;
}

/**
 * 设置当前会话 ID（由 AgentRuntime 调用）
 */
export function setConnectorToolSessionId(sessionId: string): void {
  currentSessionId = sessionId;
}

/**
 * 发送图片工具参数 Schema
 */
const SendImageSchema = Type.Object({
  imagePath: Type.String({
    description: '图片文件的路径（支持绝对路径、相对路径和 ~ 符号）',
  }),
  caption: Type.Optional(Type.String({
    description: '图片说明文字（可选）',
  })),
});

/**
 * 发送文件工具参数 Schema
 */
const SendFileSchema = Type.Object({
  filePath: Type.String({
    description: '文件的路径（支持绝对路径、相对路径和 ~ 符号）',
  }),
  fileName: Type.Optional(Type.String({
    description: '自定义文件名（可选，默认使用原文件名）',
  })),
});

/**
 * 连接器工具插件
 */
export const connectorToolPlugin: ToolPlugin = {
  metadata: {
    id: 'connector-tool',
    name: 'connector',
    version: '1.0.0',
    description: '通过连接器发送图片和文件到外部平台（如飞书）。仅在连接器会话中可用',
    author: 'DeepBot',
    category: 'network',
    tags: ['connector', 'feishu', 'image', 'file'],
    requiresConfig: false,
  },
  
  create: (options: ToolCreateOptions) => {
    return [
      // 发送图片工具
      {
        name: TOOL_NAMES.CONNECTOR_SEND_IMAGE,
        label: '发送图片到连接器',
        description: '通过连接器发送图片到外部平台（如飞书）。仅在连接器会话中可用',
        parameters: SendImageSchema,
        
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal, context?: any) => {
          try {
            if (!gatewayInstance) {
              throw new Error('Gateway 未初始化');
            }
            
            const params = args as {
              imagePath: string;
              caption?: string;
            };
            
            // 展开路径（支持 ~ 符号）
            const expandedPath = expandUserPath(params.imagePath);
            
            console.log('[Connector Tool] 📷 发送图片');
            console.log('  原始路径:', params.imagePath);
            console.log('  展开路径:', expandedPath);
            
            // 检查是否被取消
            if (signal?.aborted) {
              const err = new Error('发送图片操作被取消');
              err.name = 'AbortError';
              throw err;
            }
            
            // 获取当前会话的 Tab 信息
            const sessionId = context?.sessionId || currentSessionId;
            if (!sessionId) {
              throw new Error('无法获取会话 ID');
            }
            
            // 查找 Tab
            const tabs = gatewayInstance.getAllTabs();
            const tab = tabs.find(t => t.id === sessionId);
            
            if (!tab || tab.type !== 'connector') {
              throw new Error('此工具仅在连接器会话中可用');
            }
            
            if (!tab.connectorId || !tab.conversationId) {
              throw new Error('连接器信息不完整');
            }
            
            // 验证文件存在
            if (!existsSync(expandedPath)) {
              throw new Error(`图片文件不存在: ${expandedPath}`);
            }
            
            // 验证是图片文件
            const ext = extname(expandedPath).toLowerCase();
            const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
            if (!imageExts.includes(ext)) {
              throw new Error(`不支持的图片格式: ${ext}。支持的格式: ${imageExts.join(', ')}`);
            }
            
            // 检查是否被取消
            if (signal?.aborted) {
              const err = new Error('发送图片操作被取消');
              err.name = 'AbortError';
              throw err;
            }
            
            // 发送图片（使用展开后的路径）
            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendImage(
              tab.connectorId as any,
              tab.conversationId,
              expandedPath,
              params.caption
            );
            
            console.log('✅ [Connector Tool] 图片发送成功');
            
            // 构建结果消息
            let resultMessage = `✅ 图片已发送到 ${tab.connectorId}！\n\n`;
            resultMessage += `图片: ${basename(expandedPath)}\n`;
            
            if (params.caption) {
              resultMessage += `说明: ${params.caption}\n`;
            }
            
            return {
              content: [
                {
                  type: 'text',
                  text: resultMessage,
                },
              ],
              details: {
                success: true,
                connectorId: tab.connectorId,
                imagePath: expandedPath,
                fileName: basename(expandedPath),
              },
            };
          } catch (error) {
            console.error('[Connector Tool] ❌ 发送图片失败:', error);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ 发送图片失败: ${getErrorMessage(error)}`,
                },
              ],
              details: {
                success: false,
                error: getErrorMessage(error),
              },
              isError: true,
            };
          }
        },
      },
      
      // 发送文件工具
      {
        name: TOOL_NAMES.CONNECTOR_SEND_FILE,
        label: '发送文件到连接器',
        description: '通过连接器发送文件到外部平台（如飞书）。仅在连接器会话中可用',
        parameters: SendFileSchema,
        
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal, context?: any) => {
          try {
            if (!gatewayInstance) {
              throw new Error('Gateway 未初始化');
            }
            
            const params = args as {
              filePath: string;
              fileName?: string;
            };
            
            // 展开路径（支持 ~ 符号）
            const expandedPath = expandUserPath(params.filePath);
            
            console.log('[Connector Tool] 📎 发送文件');
            console.log('  原始路径:', params.filePath);
            console.log('  展开路径:', expandedPath);
            
            // 检查是否被取消
            if (signal?.aborted) {
              const err = new Error('发送文件操作被取消');
              err.name = 'AbortError';
              throw err;
            }
            
            // 获取当前会话的 Tab 信息
            const sessionId = context?.sessionId || currentSessionId;
            if (!sessionId) {
              throw new Error('无法获取会话 ID');
            }
            
            // 查找 Tab
            const tabs = gatewayInstance.getAllTabs();
            const tab = tabs.find(t => t.id === sessionId);
            
            if (!tab || tab.type !== 'connector') {
              throw new Error('此工具仅在连接器会话中可用');
            }
            
            if (!tab.connectorId || !tab.conversationId) {
              throw new Error('连接器信息不完整');
            }
            
            // 验证文件存在
            if (!existsSync(expandedPath)) {
              throw new Error(`文件不存在: ${expandedPath}`);
            }
            
            // 验证是文件而不是目录
            const stats = statSync(expandedPath);
            if (!stats.isFile()) {
              throw new Error(`路径不是文件: ${expandedPath}`);
            }
            
            // 检查是否被取消
            if (signal?.aborted) {
              const err = new Error('发送文件操作被取消');
              err.name = 'AbortError';
              throw err;
            }
            
            // 发送文件（使用展开后的路径）
            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendFile(
              tab.connectorId as any,
              tab.conversationId,
              expandedPath,
              params.fileName
            );
            
            console.log('✅ [Connector Tool] 文件发送成功');
            
            // 构建结果消息
            const fileName = params.fileName || basename(expandedPath);
            let resultMessage = `✅ 文件已发送到 ${tab.connectorId}！\n\n`;
            resultMessage += `文件: ${fileName}\n`;
            resultMessage += `大小: ${(stats.size / 1024).toFixed(2)} KB\n`;
            
            return {
              content: [
                {
                  type: 'text',
                  text: resultMessage,
                },
              ],
              details: {
                success: true,
                connectorId: tab.connectorId,
                filePath: expandedPath,
                fileName,
                fileSize: stats.size,
              },
            };
          } catch (error) {
            console.error('[Connector Tool] ❌ 发送文件失败:', error);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ 发送文件失败: ${getErrorMessage(error)}`,
                },
              ],
              details: {
                success: false,
                error: getErrorMessage(error),
              },
              isError: true,
            };
          }
        },
      },
    ];
  },
};
