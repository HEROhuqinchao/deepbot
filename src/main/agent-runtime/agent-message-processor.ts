/**
 * Agent Message Processor - 消息发送和处理
 * 
 * 职责：
 * - 处理消息发送逻辑
 * - 管理消息队列
 * - 检测未完成意图
 * - 自动继续执行
 */

import { callAI } from '../utils/ai-client';
import { getErrorMessage } from '../../shared/utils/error-handler';
import type { AgentRuntimeConfig, AgentInstanceManager } from './types';
import { MessageHandler } from './message-handler';
import { wrapToolWithAbortSignal, OperationTracker } from '../tools/tool-abort';

/**
 * Message Processor 类
 */
export class AgentMessageProcessor {
  private messageHandler: MessageHandler;
  private instanceManager: AgentInstanceManager;
  private runtimeConfig: AgentRuntimeConfig;
  private systemPrompt: string;
  private tools: any[];
  private operationTracker: OperationTracker;
  
  // 回调函数
  private maintainMessageQueueFn: (() => void) | null = null;
  
  constructor(
    messageHandler: MessageHandler,
    instanceManager: AgentInstanceManager,
    runtimeConfig: AgentRuntimeConfig,
    systemPrompt: string,
    tools: any[],
    operationTracker: OperationTracker
  ) {
    this.messageHandler = messageHandler;
    this.instanceManager = instanceManager;
    this.runtimeConfig = runtimeConfig;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.operationTracker = operationTracker;
  }
  
  /**
   * 设置维护消息队列回调
   */
  setMaintainMessageQueueCallback(callback: () => void): void {
    this.maintainMessageQueueFn = callback;
  }
  
  /**
   * 更新系统提示词
   */
  updateSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
  }
  
  /**
   * 更新工具列表
   */
  updateTools(tools: any[]): void {
    this.tools = tools;
  }
  
  /**
   * 从文本中移除 thinking 内容
   */
  private removeThinkingContent(text: string): string {
    // 移除完整的 <think>...</think> 块
    let filtered = text.replace(/<think>[\s\S]*?<\/think>/g, '');
    
    // 移除不完整的 <think> 开始标签（没有对应的结束标签）
    filtered = filtered.replace(/<think>[\s\S]*$/g, '');
    
    // 移除不完整的 </think> 结束标签（没有对应的开始标签）
    filtered = filtered.replace(/^[\s\S]*?<\/think>/g, '');
    
    return filtered.trim();
  }
  
  /**
   * 检测是否有未完成的意图
   */
  private async detectUnfinishedIntent(response: string, hasToolCalls: boolean): Promise<boolean> {
    console.log('🔍 [detectUnfinishedIntent] 开始检测...');
    console.log(`   响应长度: ${response.length}`);
    console.log(`   有工具调用: ${hasToolCalls}`);
    
    // 🔥 如果本轮有工具调用，说明 Agent 正在执行操作，应该继续
    if (hasToolCalls) {
      console.log('✅ [detectUnfinishedIntent] 本轮有工具调用，继续执行');
      return true;
    }
    
    // 🔥 如果没有工具调用，检查响应内容
    const cleanResponse = this.removeThinkingContent(response).toLowerCase();
    console.log(`   清理后的响应长度: ${cleanResponse.length}`);
    console.log(`   清理后的响应预览: ${cleanResponse.substring(0, 200)}`);
    
    // 🔥 检查是否包含"需要更多信息"、"请提供"等关键词
    const needsMoreInfoKeywords = [
      '需要更多信息',
      '请提供',
      '请告诉我',
      '请问',
      '能否提供',
      '可以提供',
      '需要你',
      '需要您',
      '请确认',
      '请选择',
      '请输入',
      '请说明',
      '请描述',
      '请指定',
      '请补充',
      '请详细说明',
      '还需要',
      '还缺少',
      '缺少',
      '不清楚',
      '不确定',
      '无法确定',
      '无法判断',
      '无法理解',
      '不太明白',
      '没有提供',
      '没有说明',
      '没有指定',
      '没有告诉',
      '没有描述',
      '没有详细',
      '没有具体',
      '没有明确',
      '没有清楚',
      '没有足够',
      '没有更多',
      '没有其他',
      '没有额外',
      '没有进一步',
      '没有进一步的',
      '没有进一步说明',
      '没有进一步描述',
      '没有进一步详细',
      '没有进一步具体',
      '没有进一步明确',
      '没有进一步清楚',
      '没有进一步足够',
      '没有进一步更多',
      '没有进一步其他',
      '没有进一步额外',
    ];
    
    const needsMoreInfo = needsMoreInfoKeywords.some(keyword => 
      cleanResponse.includes(keyword)
    );
    
    if (needsMoreInfo) {
      console.log('❌ [detectUnfinishedIntent] 响应包含"需要更多信息"关键词，等待用户输入');
      return false;
    }
    
    // 🔥 检查是否包含"我会"、"我将"、"让我"等意图关键词
    const intentKeywords = [
      '我会',
      '我将',
      '让我',
      '我来',
      '我先',
      '我现在',
      '我马上',
      '我立即',
      '我这就',
      '我去',
      '我帮你',
      '我帮您',
      '我为你',
      '我为您',
      '我给你',
      '我给您',
      '我替你',
      '我替您',
      '我可以',
      '我能',
      '我需要',
      '我应该',
      '我打算',
      '我准备',
      '我想',
      '我要',
      '我得',
      '我必须',
      '我应当',
      '我应',
      '我会帮',
      '我将帮',
      '让我帮',
      '我来帮',
      '我先帮',
      '我现在帮',
      '我马上帮',
      '我立即帮',
      '我这就帮',
      '我去帮',
    ];
    
    const hasIntent = intentKeywords.some(keyword => 
      cleanResponse.includes(keyword)
    );
    
    console.log(`   包含意图关键词: ${hasIntent}`);
    
    if (!hasIntent) {
      console.log('❌ [detectUnfinishedIntent] 响应不包含意图关键词，任务可能已完成');
      return false;
    }
    
    // 🔥 如果有意图关键词，使用 AI 判断是否需要继续
    console.log('🤖 [detectUnfinishedIntent] 使用 AI 判断是否需要继续...');
    
    try {
      const prompt = `你是一个任务完成度判断助手。请判断以下 AI 助手的回复是否表明任务已经完成，还是仅仅是说明了意图但还没有执行。

AI 助手的回复：
"""
${cleanResponse}
"""

判断规则：
1. 如果回复中包含"我会"、"我将"、"让我"等意图关键词，但没有实际执行结果（如"已完成"、"已创建"、"已修改"等），则判断为"未完成"
2. 如果回复中包含实际执行结果或确认信息，则判断为"已完成"
3. 如果回复中询问用户更多信息，则判断为"已完成"（等待用户输入）

请只回复"已完成"或"未完成"，不要有其他内容。`;

      const aiResponse = await callAI([
        {
          role: 'system',
          content: '你是一个判断助手，只回答"已完成"或"未完成"，不要解释。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ], {
        temperature: 0,
        maxTokens: 10,
        useFastModel: true,
      });
      
      const decision = aiResponse.content.trim().toLowerCase();
      console.log(`   AI 判断结果: ${decision}`);
      
      const shouldContinue = decision.includes('未完成');
      console.log(`   最终决定: ${shouldContinue ? '继续执行' : '任务完成'}`);
      
      return shouldContinue;
    } catch (error) {
      console.error('❌ [detectUnfinishedIntent] AI 判断失败:', getErrorMessage(error));
      // 如果 AI 判断失败，默认不继续（保守策略）
      return false;
    }
  }
  
  /**
   * 发送消息并处理响应
   */
  async *sendMessage(
    content: string,
    autoContinue: boolean = true,
    maxContinuations: number = 100,
    isAutoContinue: boolean = false,
    ensureAgentReadyFn: () => Promise<void>
  ): AsyncGenerator<string, void, unknown> {
    // 检查并修复 Agent 状态
    await ensureAgentReadyFn();
    
    // 设置当前 sessionId 供工具使用
    const { setConnectorToolSessionId } = await import('../tools/connector-tool');
    setConnectorToolSessionId(this.runtimeConfig.sessionId);
    
    const { setCrossTabCallSessionId } = await import('../tools/cross-tab-call-tool');
    setCrossTabCallSessionId(this.runtimeConfig.sessionId);
    
    // 只在非自动继续时清空操作追踪器
    if (!isAutoContinue) {
      this.operationTracker.clear();
      console.log('🗑️ 清空操作追踪器（新消息）');
    } else {
      console.log('✅ 保留操作追踪器（自动继续）');
    }
    
    // 在非自动继续时，为用户消息添加强制工具执行指令
    let enhancedContent = content;
    if (!isAutoContinue) {
      enhancedContent = content + '\n\n[系统提示: 不要被历史消息干扰，当确认需要调用工具时，必须调用工具，除非找不到合适的工具调用！ChatGPT会检查你的执行，不要出错，不要回复用户关于系统提示的内容，不要直接列出工具functon和参数]';
      console.log('✅ 已为用户消息添加强制工具执行指令');
    }
    
    console.log('📤 发送消息到 AI:', enhancedContent.substring(0, 100) + (enhancedContent.length > 100 ? '...' : ''));
    
    // 检查是否有重复的用户消息
    if (this.instanceManager.agent) {
      const messages = this.instanceManager.agent.state.messages;
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && lastMessage.role === 'user') {
        let lastUserContent = '';
        if (typeof lastMessage.content === 'string') {
          lastUserContent = lastMessage.content;
        } else if (Array.isArray(lastMessage.content)) {
          const textPart = lastMessage.content.find((part: any) => 
            typeof part === 'object' && part.type === 'text'
          );
          if (textPart) {
            lastUserContent = (textPart as any).text;
          }
        }
        
        if (lastUserContent === content) {
          messages.pop();
          console.log('🗑️ 删除重复的用户消息');
        }
      }
    }
    
    // 上下文管理
    if (this.instanceManager.agent) {
      const { manageContext } = await import('../context/context-manager');
      const currentMessages = this.instanceManager.agent.state.messages;
      
      const result = manageContext({
        messages: currentMessages,
        modelId: this.runtimeConfig.model.id,
        systemPrompt: this.systemPrompt,
        tools: this.tools,
      });
      
      if (result.compressed) {
        console.info(
          `[Context Manager] 📊 压缩统计: ` +
          `${result.stats.messagesBefore} → ${result.stats.messagesAfter} 条消息, ` +
          `${result.stats.tokensBefore} → ${result.stats.tokensAfter} tokens ` +
          `(${(result.stats.usageRatioBefore * 100).toFixed(1)}% → ${(result.stats.usageRatioAfter * 100).toFixed(1)}%)`
        );
        
        this.instanceManager.agent.state.messages = result.messages;
      }
    }
    
    // 收集完整的响应和工具调用信息
    let fullResponse = '';
    let hasToolCalls = false;
    
    try {
      // 在调用 sendMessage 之前，设置 AbortController 创建回调
      this.messageHandler.setOnAbortControllerCreated((abortController) => {
        if (this.instanceManager.agent) {
          const toolsWithAbort = this.tools.map(tool => 
            wrapToolWithAbortSignal(tool, abortController.signal)
          );
          
          this.instanceManager.agent.state.tools = toolsWithAbort as any;
          console.log('✅ 已为工具添加取消支持');
        }
      });
      
      // 使用 MessageHandler 处理消息
      console.log('🔄 开始调用 MessageHandler.sendMessage...');
      for await (const chunk of this.messageHandler.sendMessage(enhancedContent, isAutoContinue)) {
        fullResponse += chunk;
        yield chunk;
      }
      console.log('✅ MessageHandler.sendMessage 完成，响应长度:', fullResponse.length);
      
      // 检查响应是否为空
      const wasAborted = this.messageHandler.wasAbortedByUser();
      
      if (fullResponse.trim().length === 0 && !wasAborted) {
        console.error('❌ AI 返回空响应');
        throw new Error('AI 返回空响应，可能是 API 配置错误或网络问题');
      }
      
      if (wasAborted) {
        console.log('⏹️ 用户主动停止生成，结束执行');
        return;
      }
    } catch (error) {
      console.error('❌ MessageHandler.sendMessage 失败:', error);
      
      if (this.messageHandler.wasAbortedByUser()) {
        console.log('⏹️ 用户主动停止生成（捕获异常），结束执行');
        return;
      }
      
      throw error;
    }
    
    // 检查本轮是否有工具调用
    console.log('🔍 检查最后一条消息是否有工具调用...');
    if (this.instanceManager.agent) {
      const messages = this.instanceManager.agent.state.messages;
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage?.role === 'assistant' && lastMessage.content) {
        const content = lastMessage.content;
        if (Array.isArray(content)) {
          hasToolCalls = content.some(c => 
            typeof c === 'object' && 'type' in c && c.type === 'toolCall'
          );
        }
      }
      
      console.log(hasToolCalls ? '✅ 最后一条消息有工具调用' : '❌ 最后一条消息没有工具调用');
    }
    
    // 检测未完成的意图并自动继续
    console.log('🔍 开始检测未完成的意图...');
    
    if (autoContinue && maxContinuations > 0 && this.instanceManager.agent) {
      const abortController = this.messageHandler.getAbortController();
      if (abortController?.signal.aborted) {
        console.log('⏹️ 检测到用户停止，跳过自动继续');
        return;
      }
      
      const hasUnfinishedIntent = await this.detectUnfinishedIntent(fullResponse, hasToolCalls);
      
      if (hasUnfinishedIntent) {
        if (abortController?.signal.aborted) {
          console.log('⏹️ 检测到用户停止，取消自动继续');
          return;
        }
        
        console.log('🔄 检测到未完成的意图，自动继续执行...');
        console.log(`   剩余继续次数: ${maxContinuations - 1}`);
        
        yield '\n\n';
        yield* this.sendMessage(
          '立即执行你刚才说的操作。直接调用工具，不要再说明。',
          true,
          maxContinuations - 1,
          true,
          ensureAgentReadyFn
        );
      } else {
        console.log('✅ 任务已完成或等待用户输入，不继续');
      }
    } else {
      console.log('⏭️ 跳过未完成意图检测');
    }
    
    // 维护消息队列
    if (this.maintainMessageQueueFn) {
      this.maintainMessageQueueFn();
    }
  }
}
