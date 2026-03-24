/**
 * Gateway 适配器
 * 
 * 将 Web API 的概念（Tab、Config）适配到 Gateway 的接口
 */

import { EventEmitter } from 'events';
import type { Gateway } from '../main/gateway';
import type { AgentTab } from '../types/agent-tab';
import type { Message } from '../types/message';

/**
 * 虚拟 WebContents 对象
 * 
 * 在 Web 模式下替代 Electron 的 webContents，将消息转发到 EventEmitter
 */
class VirtualWebContents extends EventEmitter {
  send(channel: string, ...args: any[]): void {
    // 将 IPC 消息转换为 EventEmitter 事件
    this.emit('ipc-message', { channel, args });
  }
  
  isDestroyed(): boolean {
    return false;
  }
}

/**
 * 虚拟 BrowserWindow 对象
 * 
 * 在 Web 模式下替代 Electron 的 BrowserWindow
 */
class VirtualBrowserWindow {
  webContents: VirtualWebContents;
  
  constructor() {
    this.webContents = new VirtualWebContents();
  }
  
  isDestroyed(): boolean {
    return false;
  }
}

export class GatewayAdapter extends EventEmitter {
  private virtualWindow: VirtualBrowserWindow;
  
  constructor(private gateway: Gateway) {
    super();
    
    // 创建虚拟窗口
    this.virtualWindow = new VirtualBrowserWindow();
    
    // 监听虚拟窗口的 IPC 消息，转发为 EventEmitter 事件
    this.virtualWindow.webContents.on('ipc-message', ({ channel, args }) => {
      this.handleIpcMessage(channel, args);
    });
  }
  
  /**
   * 获取虚拟窗口（供 Gateway 使用）
   */
  getVirtualWindow(): any {
    return this.virtualWindow;
  }
  
  /**
   * 处理 IPC 消息，转换为 WebSocket 事件
   */
  private handleIpcMessage(channel: string, args: any[]): void {
    const data = args[0];
    
    // 根据 IPC 频道转换为对应的事件
    switch (channel) {
      case 'message:stream': {
        // Gateway 发送的流式消息格式：{ messageId, content, done, role?, sessionId?, ... }
        if (data.role === 'user') {
          // 用户消息 - 转发到 WebSocket
          this.emit('message_stream', {
            sessionId: data.sessionId || 'default',
            messageId: data.messageId,
            role: 'user',
            content: data.content,
            done: false
          });
        } else if (data.done) {
          // AI 响应完成 - 转发到 WebSocket
          this.emit('message_stream', {
            sessionId: data.sessionId || 'default',
            messageId: data.messageId,
            content: data.content || '',
            done: true,
            executionSteps: data.executionSteps,
            totalDuration: data.totalDuration,
            sentAt: data.sentAt
          });
        } else {
          // 流式响应片段 - 转发到 WebSocket
          this.emit('message_stream', {
            sessionId: data.sessionId || 'default',
            messageId: data.messageId,
            content: data.content,
            done: false,
            isSubAgentResult: data.isSubAgentResult,
            subAgentTask: data.subAgentTask
          });
        }
        break;
      }
      
      case 'message:execution-step-update': {
        // 执行步骤更新 - 转发到 WebSocket
        this.emit('execution_step_update', {
          sessionId: data.sessionId || 'default',
          messageId: data.messageId,
          executionSteps: data.executionSteps
        });
        break;
      }
      
      case 'command:clear-chat': {
        // 清空聊天指令 - 转发到 WebSocket
        this.emit('clear_chat', {
          sessionId: data.sessionId || 'default'
        });
        break;
      }
      
      case 'name-config:updated': {
        // 名字配置更新通知 - 转发到 WebSocket
        this.emit('name_config_update', data);
        break;
      }
      
      case 'model-config:updated': {
        // 模型配置更新通知 - 转发到 WebSocket
        this.emit('model_config_update', {});
        break;
      }
      
      case 'connector:pending-count-updated': {
        // 待授权用户数量变化推送 - 转发到 WebSocket
        this.emit('pending_count_update', data);
        break;
      }
      
      case 'agent:status': {
        this.emit('agent_status', {
          tabId: data.sessionId || 'default',
          status: data.status
        });
        break;
      }
      
      case 'message:error': {
        this.emit('message_error', {
          sessionId: data.sessionId || 'default',
          error: data.error
        });
        break;
      }
      
      case 'tab:messages-cleared': {
        this.emit('tab_messages_cleared', {
          tabId: data.tabId || 'default'
        });
        break;
      }
      
      case 'tab:history-loaded': {
        // Tab 历史消息加载完成 - 转发到 WebSocket
        this.emit('tab_history_loaded', {
          tabId: data.tabId,
          messages: data.messages
        });
        break;
      }
      
      case 'tab:created': {
        // Tab 创建 - 转发到 WebSocket
        this.emit('tab_created', {
          tab: data.tab
        });
        break;
      }
      
      case 'tab:updated': {
        // Tab 更新 - 转发到 WebSocket
        this.emit('tab_updated', {
          tabId: data.tabId,
          title: data.title
        });
        break;
      }
    }
  }
  
  /**
   * 获取所有 Tab
   */
  getAllTabs(): AgentTab[] {
    return this.gateway.getAllTabs();
  }
  
  /**
   * 创建新 Tab
   */
  async createTab(title?: string): Promise<AgentTab> {
    // 不传 title，让 Gateway 自动生成唯一名称
    return await this.gateway.createTab(title ? { title } : {});
  }
  
  /**
   * 获取指定 Tab
   */
  getTab(tabId: string): AgentTab | null {
    const tabs = this.gateway.getAllTabs();
    return tabs.find(tab => tab.id === tabId) || null;
  }
  
  /**
   * 关闭 Tab
   */
  async closeTab(tabId: string): Promise<void> {
    await this.gateway.closeTab(tabId);
  }
  
  /**
   * 发送消息
   */
  async handleSendMessage(tabId: string, content: string, clearHistory?: boolean): Promise<void> {
    // Gateway 使用 sessionId，Tab 的 id 就是 sessionId
    await this.gateway.handleSendMessage(content, tabId, undefined, clearHistory);
  }
  
  /**
   * 获取消息历史
   */
  async getMessages(tabId: string, options: { limit: number; before?: string }): Promise<Message[]> {
    const sessionManager = this.gateway.getSessionManager();
    if (!sessionManager) {
      return [];
    }
    
    try {
      // 使用 SessionManager 的 loadUIMessages 方法
      const messages = await sessionManager.loadUIMessages(tabId);
      
      // 应用分页逻辑
      let filteredMessages = messages;
      
      // 如果指定了 before，过滤出该消息之前的消息
      if (options.before) {
        const beforeIndex = messages.findIndex(m => m.id === options.before);
        if (beforeIndex > 0) {
          filteredMessages = messages.slice(0, beforeIndex);
        }
      }
      
      // 返回最后 N 条消息
      return filteredMessages.slice(-options.limit);
    } catch (error) {
      console.error('[GatewayAdapter] 获取消息历史失败:', error);
      return [];
    }
  }
  
  /**
   * 获取配置
   */
  async getConfig(): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    return {
      model: store.getModelConfig(),
      workspace: store.getWorkspaceSettings(),
      names: store.getNameConfig(),
      connectors: store.getAllConnectorConfigs(),
      imageGeneration: store.getImageGenerationToolConfig(),
      webSearch: store.getWebSearchToolConfig(),
    };
  }
  
  /**
   * 更新配置
   */
  async updateConfig(updates: any): Promise<void> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    // 更新模型配置
    if (updates.model) {
      store.saveModelConfig(updates.model);
      await this.gateway.reloadModelConfig();
    }
    
    // 更新工作目录配置
    if (updates.workspace) {
      store.saveWorkspaceSettings(updates.workspace);
      await this.gateway.reloadWorkspaceConfig();
    }
    
    // 更新名称配置
    if (updates.names) {
      if (updates.names.agentName) {
        store.saveAgentName(updates.names.agentName);
      }
      if (updates.names.userName) {
        store.saveUserName(updates.names.userName);
      }
    }
    
    // 更新连接器配置
    if (updates.connectors) {
      for (const connector of updates.connectors) {
        store.saveConnectorConfig(
          connector.connectorId,
          connector.connectorName,
          connector.config,
          connector.enabled
        );
      }
    }
    
    // 更新图片生成工具配置
    if (updates.imageGeneration) {
      store.saveImageGenerationToolConfig(updates.imageGeneration);
    }
    
    // 更新网页搜索工具配置
    if (updates.webSearch) {
      store.saveWebSearchToolConfig(updates.webSearch);
    }
  }
  
  /**
   * 环境检查
   */
  async checkEnvironment(action: 'check' | 'get_status'): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const { createEnvironmentCheckTool } = await import('../main/tools/environment-check-tool');
    
    const tool = createEnvironmentCheckTool();
    const result = await tool.execute('env-check', { action });
    
    return result.details || { success: true, data: {} };
  }
  
  /**
   * 启动 Chrome 调试
   * 
   * Web 模式下不支持此功能
   */
  async launchChromeWithDebug(_port: number): Promise<any> {
    return { 
      success: false, 
      error: 'Web 模式暂不支持 Chrome 调试功能，请使用 Electron 版本' 
    };
  }
  
  /**
   * 连接器操作
   */
  async connectorGetAll(): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    const connectorManager = this.gateway.getConnectorManager();
    const allConnectors = connectorManager.getAllConnectors();
    
    const connectors = allConnectors.map((connector: any) => {
      const configData = store.getConnectorConfig(connector.id);
      return {
        id: connector.id,
        name: connector.name,
        version: connector.version,
        enabled: configData?.enabled ?? false,
        hasConfig: configData !== null,
      };
    });
    
    return { 
      success: true, 
      connectors,
    };
  }

  
  async connectorGetConfig(connectorId: string): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    const configData = store.getConnectorConfig(connectorId);
    console.log('[GatewayAdapter] connectorGetConfig 被调用');
    console.log('  connectorId:', connectorId);
    console.log('  configData:', configData);
    
    return { 
      success: true, 
      config: configData?.config || {},
      enabled: configData?.enabled || false,
    };
  }
  
  async connectorSaveConfig(connectorId: string, config: any): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    const connectorManager = this.gateway.getConnectorManager();
    const connector = connectorManager.getConnector(connectorId as any);
    
    if (!connector) {
      return { success: false, error: `连接器不存在: ${connectorId}` };
    }
    
    // 保存配置（需要传入 connectorName）
    store.saveConnectorConfig(
      connectorId,
      connector.name,
      config,
      config.enabled ?? false
    );
    
    return { success: true, message: '配置已保存' };
  }
  
  async connectorStart(connectorId: string): Promise<any> {
    const connectorManager = this.gateway.getConnectorManager();
    await connectorManager.startConnector(connectorId as any);
    return { success: true, message: '连接器已启动' };
  }
  
  async connectorStop(connectorId: string): Promise<any> {
    const connectorManager = this.gateway.getConnectorManager();
    await connectorManager.stopConnector(connectorId as any);
    return { success: true, message: '连接器已停止' };
  }
  
  async connectorHealthCheck(connectorId: string): Promise<any> {
    const connectorManager = this.gateway.getConnectorManager();
    const connector = connectorManager.getConnector(connectorId as any);
    
    if (!connector) {
      return { success: false, status: 'not_found', message: '连接器不存在' };
    }
    
    try {
      const health = await connector.healthCheck();
      return { 
        success: true, 
        status: health.status,
        message: health.message
      };
    } catch (error) {
      return { 
        success: false, 
        status: 'unhealthy',
        message: error instanceof Error ? error.message : '健康检查失败'
      };
    }
  }
  
  async connectorApprovePairing(pairingCode: string): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    store.approvePairingRecord(pairingCode);
    return { success: true, message: '配对已批准' };
  }
  
  async connectorSetAdminPairing(connectorId: string, userId: string, isAdmin: boolean): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    store.setAdminPairing(connectorId, userId, isAdmin);
    return { success: true, message: '管理员权限已更新' };
  }
  
  async connectorDeletePairing(connectorId: string, userId: string): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    store.deletePairingRecord(connectorId, userId);
    return { success: true, message: '配对已删除' };
  }
  
  async connectorGetPairingRecords(): Promise<any> {
    const { SystemConfigStore } = await import('../main/database/system-config-store');
    const store = SystemConfigStore.getInstance();
    
    const records = store.getAllPairingRecords();
    return { success: true, records };
  }
  
  /**
   * 定时任务
   */
  async scheduledTask(request: any): Promise<any> {
    const { createScheduledTaskTool } = await import('../main/tools/scheduled-task-tool');
    
    const tool = createScheduledTaskTool();
    const result = await tool.execute('scheduled-task', request);
    
    return result.details || { success: true, data: {} };
  }
  
  /**
   * 停止生成
   */
  async stopGeneration(sessionId?: string): Promise<void> {
    await this.gateway.handleStopGeneration(sessionId);
  }
  
  /**
   * 文件上传
   */
  async uploadFile(_fileName: string, _dataUrl: string, _fileSize: number, _fileType: string): Promise<any> {
    // Web 模式下，文件上传功能需要通过主进程实现
    // 这里返回一个占位符实现
    return { 
      success: false, 
      error: 'Web 模式暂不支持文件上传，请使用 Electron 版本' 
    };
  }
  
  async uploadImage(_fileName: string, _dataUrl: string, _fileSize: number): Promise<any> {
    // Web 模式下，图片上传功能需要通过主进程实现
    return { 
      success: false, 
      error: 'Web 模式暂不支持图片上传，请使用 Electron 版本' 
    };
  }
  
  async readImage(_filePath: string): Promise<any> {
    // Web 模式下，图片读取功能需要通过主进程实现
    return { 
      success: false, 
      error: 'Web 模式暂不支持图片读取，请使用 Electron 版本' 
    };
  }
  
  async deleteTempFile(_filePath: string): Promise<any> {
    // Web 模式下，文件删除功能需要通过主进程实现
    return { 
      success: true 
    };
  }
  
  /**
   * Skill 管理
   */
  async skillManager(request: any): Promise<any> {
    const { createSkillManagerTool } = await import('../main/tools/skill-manager-tool');
    const { getErrorMessage } = await import('../shared/utils/error-handler');
    
    const tool = createSkillManagerTool();
    
    try {
      const result = await tool.execute('skill-manager', request);
      
      // Tool 返回格式: { content: [...], details: actualData }
      // details.success === false 表示工具执行失败
      if (result.details?.success === false) {
        return {
          success: false,
          error: result.details?.error || '未知错误',
        };
      }
      
      // 统一返回格式：添加 success: true 并展开 details
      return {
        success: true,
        ...result.details,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }
  
  /**
   * 检查并发送欢迎消息
   */
  async checkAndSendWelcomeMessage(): Promise<void> {
    return this.gateway.getTabManager().checkAndSendWelcomeMessage();
  }
}
