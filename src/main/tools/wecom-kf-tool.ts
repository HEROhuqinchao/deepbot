/**
 * 企微客服工具（插件）
 *
 * 提供三个工具：
 * - wecom_kf_send_message：向企微客服用户发送文本消息
 * - wecom_kf_send_image：向企微客服用户发送图片
 * - wecom_kf_send_file：向企微客服用户发送文件
 */

import { Type } from '@sinclair/typebox';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { expandUserPath } from '../../shared/utils/path-utils';
import type { Gateway } from '../gateway';
import { TOOL_NAMES } from './tool-names';
import { createLogger } from '../../shared/utils/logger';

const logger = createLogger('WecomKfTool');

let gatewayInstance: Gateway | null = null;

export function setGatewayForWecomKfTool(gateway: Gateway): void {
  gatewayInstance = gateway;
}

/**
 * 解析企微客服发送目标
 * 
 * 优先级：
 * 1. 提供了 tabName → 查找对应 Tab 的 conversationId
 * 2. 当前 Tab 是企微客服 connector → 直接用当前会话
 */
function resolveWecomKfTarget(sessionId: string, tabName?: string): { conversationId: string; connectorId: string } {
  if (!gatewayInstance) throw new Error('Gateway 未初始化');

  // 情况 1：提供了 tabName
  if (tabName) {
    const tabs = gatewayInstance.getAllTabs();
    const normalizedQuery = tabName.replace(/\s+/g, '');
    const targetTab = tabs.find(t => t.title.replace(/\s+/g, '') === normalizedQuery);
    if (!targetTab) throw new Error(`未找到名为 "${tabName}" 的 Tab`);
    if (targetTab.connectorId !== 'wecom-kf' || !targetTab.conversationId) {
      throw new Error(`Tab "${tabName}" 不是企微客服会话 Tab`);
    }
    return { conversationId: targetTab.conversationId, connectorId: targetTab.connectorId };
  }

  // 情况 2：当前 Tab 是企微客服 connector
  const tabs = gatewayInstance.getAllTabs();
  const currentTab = tabs.find(t => t.id === sessionId);
  if (currentTab?.type === 'connector' && currentTab.connectorId === 'wecom-kf' && currentTab.conversationId) {
    return { conversationId: currentTab.conversationId, connectorId: currentTab.connectorId };
  }

  throw new Error('无法确定发送目标。请提供 tabName 参数，或在企微客服会话 Tab 中调用');
}

// ── 工具插件 ──────────────────────────────────────────────────────────────────

export const wecomKfToolPlugin: ToolPlugin = {
  metadata: {
    id: 'wecom-kf',
    name: '企微客服消息',
    version: '1.0.0',
    description: '向企微客服用户发送文本消息、图片、文件',
    author: 'DeepBot',
    category: 'network',
    tags: ['wecom', 'kf', 'message', 'image', 'file'],
    requiresConfig: false,
  },

  create: (_options: ToolCreateOptions) => {
    const sessionId = (_options as any).sessionId as string | undefined;

    return [
      // ── wecom_kf_send_message ───────────────────────────────────────
      {
        name: TOOL_NAMES.WECOM_KF_SEND_MESSAGE,
        label: '发送企微客服消息',
        description: '向企微客服用户发送文本消息。在企微客服会话中调用时，默认发给当前会话；也可通过 tabName 指定目标。',
        parameters: Type.Object({
          message: Type.String({ description: '要发送的文本消息内容' }),
          tabName: Type.Optional(Type.String({ description: '目标 Tab 名称（如 "QW-客服-张三"）' })),
        }),
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
          try {
            if (!gatewayInstance) throw new Error('Gateway 未初始化');
            if (signal?.aborted) throw Object.assign(new Error('操作被取消'), { name: 'AbortError' });
            if (!sessionId) throw new Error('无法获取会话 ID');

            const target = resolveWecomKfTarget(sessionId, args.tabName);
            logger.info('发送企微客服消息:', { target, messageLength: args.message.length });

            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendOutgoingMessage(target.connectorId, target.conversationId, args.message);

            return {
              content: [{ type: 'text', text: '✅ 企微客服消息已发送' }],
              details: { success: true },
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `❌ 发送失败: ${getErrorMessage(error)}` }],
              details: { success: false, error: getErrorMessage(error) },
              isError: true,
            };
          }
        },
      },

      // ── wecom_kf_send_image ─────────────────────────────────────────
      {
        name: TOOL_NAMES.WECOM_KF_SEND_IMAGE,
        label: '发送企微客服图片',
        description: '向企微客服用户发送图片。支持本地图片路径。',
        parameters: Type.Object({
          imagePath: Type.String({ description: '图片文件路径，支持 ~ 符号' }),
          tabName: Type.Optional(Type.String({ description: '目标 Tab 名称' })),
        }),
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
          try {
            if (!gatewayInstance) throw new Error('Gateway 未初始化');
            if (signal?.aborted) throw Object.assign(new Error('操作被取消'), { name: 'AbortError' });
            if (!sessionId) throw new Error('无法获取会话 ID');

            const expandedPath = expandUserPath(args.imagePath);
            if (!existsSync(expandedPath)) throw new Error(`图片文件不存在: ${args.imagePath}`);

            const target = resolveWecomKfTarget(sessionId, args.tabName);
            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendImage(target.connectorId, target.conversationId, expandedPath);

            return {
              content: [{ type: 'text', text: '✅ 企微客服图片已发送' }],
              details: { success: true },
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `❌ 发送失败: ${getErrorMessage(error)}` }],
              details: { success: false, error: getErrorMessage(error) },
              isError: true,
            };
          }
        },
      },

      // ── wecom_kf_send_file ──────────────────────────────────────────
      {
        name: TOOL_NAMES.WECOM_KF_SEND_FILE,
        label: '发送企微客服文件',
        description: '向企微客服用户发送文件。支持本地文件路径。',
        parameters: Type.Object({
          filePath: Type.String({ description: '文件路径，支持 ~ 符号' }),
          fileName: Type.Optional(Type.String({ description: '文件名（可选，默认使用原文件名）' })),
          tabName: Type.Optional(Type.String({ description: '目标 Tab 名称' })),
        }),
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
          try {
            if (!gatewayInstance) throw new Error('Gateway 未初始化');
            if (signal?.aborted) throw Object.assign(new Error('操作被取消'), { name: 'AbortError' });
            if (!sessionId) throw new Error('无法获取会话 ID');

            const expandedPath = expandUserPath(args.filePath);
            if (!existsSync(expandedPath)) throw new Error(`文件不存在: ${args.filePath}`);

            const target = resolveWecomKfTarget(sessionId, args.tabName);
            const connectorManager = gatewayInstance.getConnectorManager();
            await connectorManager.sendFile(target.connectorId, target.conversationId, expandedPath, args.fileName);

            return {
              content: [{ type: 'text', text: `✅ 企微客服文件已发送: ${args.fileName || basename(expandedPath)}` }],
              details: { success: true },
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `❌ 发送失败: ${getErrorMessage(error)}` }],
              details: { success: false, error: getErrorMessage(error) },
              isError: true,
            };
          }
        },
      },
    ];
  },
};
