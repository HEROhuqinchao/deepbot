/**
 * 跨 Tab 调用工具
 * 
 * 允许不同 Tab 之间互相发送消息进行协作
 */

import { Type } from '@sinclair/typebox';
import type { ToolPlugin, ToolCreateOptions } from './registry/tool-interface';
import { getErrorMessage } from '../../shared/utils/error-handler';
import type { Gateway } from '../gateway';
import { TOOL_NAMES } from './tool-names';

let currentCrossTabSessionId: string | null = null;

/**
 * 设置当前会话 ID（由 AgentRuntime 调用）
 */
export function setCrossTabCallSessionId(sessionId: string): void {
  currentCrossTabSessionId = sessionId;
}

let gatewayInstance: Gateway | null = null;

/**
 * 设置 Gateway 实例
 */
export function setGatewayForCrossTabCallTool(gateway: Gateway): void {
  gatewayInstance = gateway;
}

/**
 * 跨 Tab 调用工具参数 Schema
 */
const CrossTabCallSchema = Type.Object({
  targetTabName: Type.String({
    description: '目标 Tab 的名称（如"市场分析助理"、"产品经理"等）',
  }),
  message: Type.String({
    description: '要发送的消息内容',
  }),
  requireReply: Type.Optional(Type.Boolean({
    description: '是否要求目标 Tab 回复。true=要求回复，false=不要求回复（默认 false）',
    default: false,
  })),
  senderTabName: Type.Optional(Type.String({
    description: '发送者 Tab 的名称（由系统自动填充，Agent 无需提供）',
  })),
});

/**
 * 跨 Tab 调用工具插件
 */
export const crossTabCallToolPlugin: ToolPlugin = {
  metadata: {
    id: 'cross-tab-call-tool',
    name: TOOL_NAMES.CROSS_TAB_CALL,
    version: '1.0.0',
    description: '向其他 Tab 发送消息。用于多 Agent 协作场景，Tab 之间可以互相对话',
    author: 'DeepBot',
    category: 'system',
    tags: ['cross-tab', 'agent', 'collaboration'],
    requiresConfig: false,
  },
  
  create: (_options: ToolCreateOptions) => {
    return [
      {
        name: TOOL_NAMES.CROSS_TAB_CALL,
        label: '跨 Tab 消息',
        description: '向其他 Tab 发送消息。用于多 Agent 协作场景，Tab 之间可以互相对话',
        parameters: CrossTabCallSchema,
        
        execute: async (_toolCallId: string, args: any, signal?: AbortSignal) => {
          try {
            if (!gatewayInstance) {
              throw new Error('Gateway 未初始化');
            }
            
            const params = args as {
              targetTabName: string;
              message: string;
              requireReply?: boolean;
              senderTabName?: string; // 由 AgentRuntime 注入
            };
            
            console.log('[Cross Tab Call] 🔄 跨 Tab 消息');
            console.log('  目标 Tab:', params.targetTabName);
            console.log('  消息:', params.message);
            console.log('  要求回复:', params.requireReply ?? false);
            console.log('  发送者 Tab:', params.senderTabName || '未知');
            
            // 检查是否被取消
            if (signal?.aborted) {
              const err = new Error('跨 Tab 消息操作被取消');
              err.name = 'AbortError';
              throw err;
            }
            
            // 查找目标 Tab
            const tabs = gatewayInstance.getAllTabs();
            const targetTab = tabs.find(t => t.title === params.targetTabName);
            
            if (!targetTab) {
              throw new Error(`未找到名为"${params.targetTabName}"的 Tab。可用的 Tab: ${tabs.map(t => t.title).join(', ')}`);
            }
            
            console.log('[Cross Tab Call] ✅ 找到目标 Tab:', targetTab.id);
            
            // 🔥 使用参数中的 senderTabName（由 AgentRuntime 注入）
            const senderName = params.senderTabName || '未知 Tab';
            
            console.log('[Cross Tab Call] 📍 发送者名称:', senderName);
            
            // 构建消息（标记来源）
            const messageWithSource = `[来自 ${senderName}]\n${params.message}`;
            
            // 🔥 根据 requireReply 参数决定是否添加系统指令
            let fullMessage = messageWithSource;
            const systemPrompt = `\n\n[系统提示: 收到来自其他 Tab 的消息，请先在响应开头显示"📨 收到来自 ${senderName} 的消息：${params.message.substring(0, 50)}${params.message.length > 50 ? '...' : ''}"，然后再处理消息内容`;
            
            if (params.requireReply) {
              // 添加系统指令，强制要求回复
              const replyInstruction = `。处理完成后必须使用 cross_tab_call 工具将结果发送回 "${senderName}"。参数：targetTabName="${senderName}", message="你的回复内容", requireReply=false（重要：回复时必须设置 requireReply=false 避免无限循环）]`;
              fullMessage = messageWithSource + systemPrompt + replyInstruction;
              console.log('[Cross Tab Call] 📝 已添加回复指令');
            } else {
              fullMessage = messageWithSource + systemPrompt + `]`;
              console.log('[Cross Tab Call] 📝 不要求回复');
            }
            
            // 发送消息到目标 Tab（异步，不等待结果）
            // displayContent 用于前端显示（包含来源标记，但不包含系统指令）
            console.log('[Cross Tab Call] 📤 发送消息到目标 Tab...');
            gatewayInstance.handleSendMessage(
              fullMessage,        // 完整消息（包含来源标记和系统提示）
              targetTab.id,       // 目标 Tab ID
              messageWithSource   // 前端显示内容（包含来源标记，但不包含系统提示）
            ).catch(error => {
              console.error('[Cross Tab Call] ❌ 发送消息失败:', error);
            });
            
            // 立即返回成功
            let resultMessage = `✅ 消息已发送到 ${params.targetTabName}\n\n消息内容：\n${params.message}`;
            if (params.requireReply) {
              resultMessage += `\n\n💡 已要求目标 Tab 回复结果`;
            } else {
              resultMessage += `\n\n💡 不要求目标 Tab 回复`;
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
                targetTabName: params.targetTabName,
                targetTabId: targetTab.id,
                message: params.message,
                senderName,
              },
            };
          } catch (error) {
            console.error('[Cross Tab Call] ❌ 跨 Tab 消息失败:', error);
            
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ 跨 Tab 消息失败: ${getErrorMessage(error)}`,
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
