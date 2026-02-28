/**
 * Chat 工具（AI 对话工具）
 * 支持流式输出
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { TOOL_NAMES } from './tool-names';
import type { SystemConfigStore } from '../database/system-config-store';

const ChatToolSchema = Type.Object({
  prompt: Type.String({ description: '用户提示词或问题' }),
  content: Type.Optional(Type.String({ description: '需要处理的内容' })),
  systemPrompt: Type.Optional(Type.String({ description: '系统提示词' })),
  maxChunkSize: Type.Optional(Type.Number({ description: '分段大小，默认 8000' })),
});

const DEFAULT_MAX_CHUNK_SIZE = 8000;
const DEFAULT_CHUNK_OVERLAP = 200;

function splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
  if (text.length <= maxChunkSize) return [text];
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + maxChunkSize;
    
    if (end < text.length) {
      const sentenceEnds = ['\n\n', '。', '！', '？', '.', '!', '?'];
      let bestEnd = end;
      
      for (const sentenceEnd of sentenceEnds) {
        const lastIndex = text.lastIndexOf(sentenceEnd, end);
        if (lastIndex > start + maxChunkSize * 0.8) {
          bestEnd = lastIndex + sentenceEnd.length;
          break;
        }
      }
      
      end = bestEnd;
    }
    
    chunks.push(text.slice(start, end));
    start = end - DEFAULT_CHUNK_OVERLAP;
    if (start < 0) start = end;
  }
  
  return chunks;
}

function createModel(configStore: SystemConfigStore): Model<'openai-completions'> {
  const modelConfig = configStore.getModelConfig();
  
  if (!modelConfig || !modelConfig.apiKey) {
    throw new Error('模型未配置。请在系统设置中配置 API Key');
  }
  
  return {
    api: 'openai-completions',
    id: modelConfig.modelId,
    name: modelConfig.modelId,
    provider: modelConfig.providerName || 'openai',
    input: ['text'],
    reasoning: false,
    baseUrl: modelConfig.baseUrl,
    contextWindow: 8192,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

async function callAIStream(params: {
  messages: Array<{ role: string; content: string }>;
  configStore: SystemConfigStore;
  signal?: AbortSignal;
  onUpdate?: (text: string) => void;
}): Promise<string> {
  const { messages, configStore, signal, onUpdate } = params;
  const modelConfig = configStore.getModelConfig();
  
  if (!modelConfig || !modelConfig.apiKey) {
    throw new Error('模型未配置');
  }
  
  console.log('[Chat Tool] 调用 AI 模型（流式）...');
  
  if (signal?.aborted) {
    const err = new Error('AI 调用被取消');
    err.name = 'AbortError';
    throw err;
  }
  
  const model = createModel(configStore);
  const piAI = await eval('import("@mariozechner/pi-ai")');
  
  const formattedMessages = messages.map(msg => ({
    role: msg.role as 'system' | 'user' | 'assistant',
    content: msg.content,
    timestamp: Date.now(),
  }));
  
  const context: any = { messages: formattedMessages };
  const piOptions: any = { temperature: 0.7, apiKey: modelConfig.apiKey };
  
  let fullResponse = '';
  
  try {
    const streamGenerator = piAI.streamSimple(model, context, piOptions);
    
    let aborted = false;
    if (signal) {
      signal.addEventListener('abort', () => {
        console.log('[Chat Tool] ⏹️ 收到停止信号');
        aborted = true;
      }, { once: true });
    }
    
    for await (const event of streamGenerator) {
      if (aborted || signal?.aborted) {
        const err = new Error('AI 调用被取消');
        err.name = 'AbortError';
        throw err;
      }
      
      if (event.type === 'error') {
        throw new Error(`AI API 错误: ${event.error?.errorMessage || '未知错误'}`);
      }
      
      // 注意：事件类型是 text_delta（下划线），不是 text-delta
      if (event.type === 'text_delta' && event.delta) {
        fullResponse += event.delta;
        onUpdate?.(fullResponse);
      }
      
      if (event.type === 'done' && event.reason === 'error') {
        throw new Error(`AI API 错误: ${event.message?.content || '未知错误'}`);
      }
    }
    
    if (!fullResponse || fullResponse.trim().length === 0) {
      throw new Error('AI 返回空响应');
    }
    
    console.log('[Chat Tool] ✅ AI 流式调用成功');
    return fullResponse.trim();
  } catch (error) {
    console.error('[Chat Tool] ❌ AI 流式调用失败:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        throw new Error('API Key 无效');
      } else if (error.message.includes('404') || error.message.includes('Not Found')) {
        throw new Error('模型不存在');
      } else if (error.message.includes('timeout')) {
        throw new Error('API 请求超时');
      }
    }
    
    throw error;
  }
}

export function createChatTool(configStore: SystemConfigStore): AgentTool {
  return {
    name: TOOL_NAMES.CHAT,
    label: 'AI Chat',
    description: '调用 AI 模型进行对话、翻译、总结、改写等任务。支持长文本自动分段处理和流式输出',
    parameters: ChatToolSchema,
    
    execute: async (
      _toolCallId: string,
      args: any,
      signal?: AbortSignal,
      onUpdate?: (result: AgentToolResult<any>) => void
    ): Promise<AgentToolResult<any>> => {
      try {
        const params = args as {
          prompt: string;
          content?: string;
          systemPrompt?: string;
          maxChunkSize?: number;
        };
        
        console.log('[Chat Tool] 🚀 开始处理...');
        
        if (signal?.aborted) {
          const err = new Error('Chat 操作被取消');
          err.name = 'AbortError';
          throw err;
        }
        
        if (!params.prompt || !params.prompt.trim()) {
          throw new Error('缺少参数: prompt');
        }
        
        const maxChunkSize = params.maxChunkSize || DEFAULT_MAX_CHUNK_SIZE;
        
        // 无 content，直接对话
        if (!params.content) {
          const messages: Array<{ role: string; content: string }> = [];
          
          if (params.systemPrompt) {
            messages.push({ role: 'system', content: params.systemPrompt });
          }
          
          messages.push({ role: 'user', content: params.prompt });
          
          const fullAnswer = await callAIStream({
            messages,
            configStore,
            signal,
            onUpdate: (text) => {
              onUpdate?.({
                content: [{ type: 'text', text }],
                details: { success: true, chunks: 1, totalLength: text.length, streaming: true },
              });
            },
          });
          
          return {
            content: [{ type: 'text', text: fullAnswer }],
            details: { success: true, chunks: 1, totalLength: fullAnswer.length, streaming: false },
          };
        }
        
        // 有 content，分段处理
        const chunks = splitTextIntoChunks(params.content, maxChunkSize);
        
        console.log('[Chat Tool] 文本分段:', chunks.length, '段');
        
        // 单段
        if (chunks.length === 1) {
          const messages: Array<{ role: string; content: string }> = [];
          
          if (params.systemPrompt) {
            messages.push({ role: 'system', content: params.systemPrompt });
          }
          
          messages.push({ role: 'user', content: `${params.prompt}\n\n${params.content}` });
          
          const fullAnswer = await callAIStream({
            messages,
            configStore,
            signal,
            onUpdate: (text) => {
              onUpdate?.({
                content: [{ type: 'text', text }],
                details: { success: true, chunks: 1, totalLength: text.length, streaming: true },
              });
            },
          });
          
          return {
            content: [{ type: 'text', text: fullAnswer }],
            details: { success: true, chunks: 1, totalLength: fullAnswer.length, streaming: false },
          };
        }
        
        // 多段处理
        const results: string[] = [];
        
        for (let i = 0; i < chunks.length; i++) {
          if (signal?.aborted) {
            const err = new Error('Chat 操作被取消');
            err.name = 'AbortError';
            throw err;
          }
          
          console.log(`[Chat Tool] 处理第 ${i + 1}/${chunks.length} 段...`);
          
          const messages: Array<{ role: string; content: string }> = [];
          
          if (params.systemPrompt) {
            messages.push({ role: 'system', content: params.systemPrompt });
          }
          
          const chunkPrompt = `${params.prompt}\n\n[这是第 ${i + 1}/${chunks.length} 部分，请处理这部分内容，保持格式和风格一致]\n\n${chunks[i]}`;
          messages.push({ role: 'user', content: chunkPrompt });
          
          const chunkAnswer = await callAIStream({
            messages,
            configStore,
            signal,
            onUpdate: (text) => {
              const tempResults = [...results, text];
              const fullResult = tempResults.join('\n\n');
              
              onUpdate?.({
                content: [{ type: 'text', text: fullResult }],
                details: {
                  success: true,
                  chunks: chunks.length,
                  currentChunk: i + 1,
                  totalLength: fullResult.length,
                  streaming: true,
                },
              });
            },
          });
          
          results.push(chunkAnswer);
        }
        
        const fullResult = results.join('\n\n');
        
        console.log('[Chat Tool] ✅ 全部完成');
        
        return {
          content: [{ type: 'text', text: fullResult }],
          details: { success: true, chunks: chunks.length, totalLength: fullResult.length, streaming: false },
        };
      } catch (error) {
        console.error('[Chat Tool] ❌ 失败:', error);
        
        return {
          content: [{ type: 'text', text: `❌ Chat 失败: ${getErrorMessage(error)}` }],
          details: { success: false, error: getErrorMessage(error) },
        };
      }
    },
  };
}
