/**
 * Slack 连接器
 * 
 * 使用 Slack Bolt 框架的 Socket Mode 实现双向通信
 * 
 * 参考：
 * - https://api.slack.com/apis/connections/socket
 * - https://api.slack.com/apis/events-api
 */

import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import type {
  Connector,
  SlackConnectorConfig,
  SlackIncomingMessage,
  HealthStatus,
} from '../../../types/connector';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { ensureDirectoryExists } from '../../../shared/utils/fs-utils';
import type { ConnectorManager } from '../connector-manager';
import { SystemConfigStore } from '../../database/system-config-store';
import { EventEmitter } from 'events';


export class SlackConnector implements Connector {
  readonly id = 'slack' as const;
  readonly name = 'Slack';
  readonly version = '1.0.0';
  
  private connectorConfig!: SlackConnectorConfig;
  private wsClient?: SlackSocketClient;
  private connectorManager: ConnectorManager;
  private isStarted: boolean = false;
  
  // 消息去重
  private processedMessages: Set<string> = new Set();
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  
  // 用户信息缓存
  private userInfoCache: Map<string, { name: string; avatar?: string }> = new Map();
  
  constructor(connectorManager: ConnectorManager) {
    this.connectorManager = connectorManager;
  }
  
  // ========== 配置管理 ==========
  config = {
    load: async (): Promise<SlackConnectorConfig | null> => {
      const store = SystemConfigStore.getInstance();
      const result = store.getConnectorConfig('slack');
      
      if (!result) {
        return null;
      }
      
      return {
        ...result.config,
        enabled: result.enabled,
      } as SlackConnectorConfig;
    },
    
    save: async (config: SlackConnectorConfig): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.saveConnectorConfig('slack', 'Slack', config, false);
    },
    
    validate: (config: SlackConnectorConfig): boolean => {
      return !!(
        config.botToken &&
        config.appToken &&
        config.signingSecret
      );
    },
  };
  
  // ========== 生命周期 ==========
  
  async initialize(config: SlackConnectorConfig): Promise<void> {
    this.connectorConfig = config;
    console.log('[SlackConnector] 初始化完成');
  }
  
  async start(): Promise<void> {
    if (this.isStarted) {
      console.log('[SlackConnector] ⚠️ 连接器已启动，跳过重复启动');
      return;
    }
    
    console.log('[SlackConnector] 🚀 开始启动 Slack 连接器...');
    
    // 初始化 Socket Mode 客户端
    this.wsClient = new SlackSocketClient({
      appToken: this.connectorConfig.appToken,
      botToken: this.connectorConfig.botToken,
    });
    
    // 注册消息回调
    this.wsClient.on('message', (data: any) => {
      this.handleIncomingMessage(data).catch((error) => {
        console.error('[SlackConnector] ❌ 处理消息失败:', error);
      });
    });
    
    // 启动连接
    await this.wsClient.start();
    this.isStarted = true;
    
    console.log('[SlackConnector] ✅ 连接器已启动');
  }
  
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    console.log('[SlackConnector] 🛑 停止连接器...');
    
    if (this.wsClient) {
      this.wsClient.stop();
      this.wsClient = undefined;
    }
    
    this.isStarted = false;
    console.log('[SlackConnector] ✅ 连接器已停止');
  }
  
  async healthCheck(): Promise<HealthStatus> {
    if (this.isStarted && this.wsClient?.isConnected()) {
      return {
        status: 'healthy',
        message: '连接正常',
      };
    }
    
    return {
      status: 'unhealthy',
      message: this.wsClient ? '连接器未完全启动' : 'Socket Mode 未连接',
    };
  }
  
  // ========== 消息处理 ==========
  
  private async handleIncomingMessage(event: any): Promise<void> {
    try {
      // 忽略机器人自己的消息
      if (event.bot_id || event.subtype === 'bot_message') {
        return;
      }
      
      const payload = event.payload || event;
      const eventType = event.type || payload.type;
      
      // 处理不同类型的消息事件
      if (eventType === 'event_callback') {
        const innerEvent = payload.event;
        if (!innerEvent) return;
        
        await this.processMessageEvent(innerEvent, payload);
      } else if (eventType === 'message' || eventType === 'app_mention') {
        await this.processMessageEvent(event, payload);
      }
      
    } catch (error) {
      console.error('[SlackConnector] ❌ 处理消息失败:', error);
    }
  }
  
  private async processMessageEvent(event: any, payload: any): Promise<void> {
    // 解析 Slack 消息格式
    const messageId = event.client_msg_id || event.ts;
    const senderId = event.user;
    const channel = event.channel;
    const text = event.text || '';
    const threadTs = event.thread_ts;
    
    // 忽略空消息
    if (!text.trim()) {
      return;
    }
    
    // 消息去重
    if (this.processedMessages.has(messageId)) {
      return;
    }
    this.processedMessages.add(messageId);
    if (this.processedMessages.size > this.MAX_PROCESSED_MESSAGES) {
      const firstItem = this.processedMessages.values().next().value;
      if (firstItem) {
        this.processedMessages.delete(firstItem);
      }
    }
    
    // 获取用户信息
    const userInfo = await this.fetchUserInfo(senderId);
    
    // 判断是否是群聊（以 C 开头是公共频道，G 开头是私有频道/群组）
    const isGroup = channel.startsWith('C') || channel.startsWith('G');
    
    // 判断是否 @ 了机器人
    const isBotMentioned = event.type === 'app_mention' || 
      text.includes(`<@${await this.getBotUserId()}>`);
    
    // 构建内部消息格式
    const slackMessage: SlackIncomingMessage = {
      messageId,
      timestamp: Date.now(),
      sender: {
        id: senderId,
        name: userInfo.name,
        avatar: userInfo.avatar,
      },
      conversation: {
        id: channel,
        type: isGroup ? 'group' : 'p2p',
      },
      content: {
        type: 'text',
        text: this.cleanMessageText(text),
      },
      mentions: {
        isBotMentioned,
        mentionList: [],
      },
      raw: event,
    };
    
    // 安全检查
    if (!this.checkSecurity(slackMessage)) {
      if (slackMessage.conversation.type === 'p2p') {
        const code = this.pairing!.generatePairingCode(
          slackMessage.sender.id,
          slackMessage.sender.name
        );
        
        const store = SystemConfigStore.getInstance();
        const record = store.getPairingRecordByUser('slack', slackMessage.sender.id);
        if (record?.approved) {
          slackMessage.systemContext = `[系统通知] 这是第一次有用户连接到 DeepBot。`;
          await this.connectorManager.handleIncomingMessage('slack', slackMessage);
          return;
        }
        
        await this.outbound.sendMessage({
          conversationId: slackMessage.conversation.id,
          content: `Please authorize with pairing code: ${code}\n\nAdmin can approve with: deepbot pairing approve slack ${code}`,
        });
      }
      return;
    }
    
    // 群聊需要 @ 机器人
    if (isGroup && !isBotMentioned) {
      return;
    }
    
    // 转发到 ConnectorManager
    await this.connectorManager.handleIncomingMessage('slack', slackMessage);
  }
  
  /**
   * 清理消息文本（移除 @ 提及等）
   */
  private cleanMessageText(text: string): string {
    // 移除 <@UXXXXX> 格式的提及
    return text.replace(/<@[A-Z0-9]+>/g, '').trim();
  }
  
  /**
   * 获取机器人用户 ID
   */
  private botUserId?: string;
  private async getBotUserId(): Promise<string> {
    if (this.botUserId) {
      return this.botUserId;
    }
    
    try {
      const response = await fetch('https://slack.com/api/auth.test', {
        headers: {
          'Authorization': `Bearer ${this.connectorConfig.botToken}`,
        },
      });
      
      const data = await response.json() as any;
      if (data.ok && data.user_id) {
        this.botUserId = data.user_id;
        return this.botUserId!;
      }
    } catch (error) {
      console.error('[SlackConnector] 获取 Bot User ID 失败:', error);
    }
    
    return '';
  }
  
  /**
   * 获取用户信息
   */
  private async fetchUserInfo(userId: string): Promise<{ name: string; avatar?: string }> {
    const cached = this.userInfoCache.get(userId);
    if (cached) {
      return cached;
    }
    
    try {
      const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
        headers: {
          'Authorization': `Bearer ${this.connectorConfig.botToken}`,
        },
      });
      
      const data = await response.json() as any;
      if (data.ok && data.user) {
        const info = {
          name: data.user.real_name || data.user.name || `User_${userId.slice(-8)}`,
          avatar: data.user.profile?.image_48,
        };
        this.userInfoCache.set(userId, info);
        return info;
      }
    } catch (error) {
      // 忽略错误，使用默认值
    }
    
    return { name: `User_${userId.slice(-8)}` };
  }
  
  /**
   * 安全检查
   */
  private checkSecurity(message: SlackIncomingMessage): boolean {
    if (message.conversation.type === 'p2p') {
      if (this.connectorConfig.requirePairing !== true) {
        this.autoApproveUser(message.sender.id, message.sender.name);
        return true;
      }
      return this.pairing!.verifyPairingCode(message.sender.id);
    }
    
    return message.mentions?.isBotMentioned ?? false;
  }
  
  /**
   * 自动批准用户
   */
  private autoApproveUser(userId: string, userName?: string): void {
    const store = SystemConfigStore.getInstance();
    if (store.getPairingRecordByUser('slack', userId)) return;
    
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const isFirstUser = store.getAllPairingRecords('slack').length === 0;
    
    store.savePairingRecord('slack', userId, code, userName);
    store.approvePairingRecord(code);
    
    if (isFirstUser) {
      store.setAdminPairing('slack', userId, true);
    }
    
    console.log('[SlackConnector] 🔓 免配对模式：用户已自动加入', { userId, userName });
  }
  
  // ========== 消息发送 ==========
  
  outbound = {
    sendMessage: async (params: {
      conversationId: string;
      content: string;
      replyTo?: string;
      replyToMessageId?: string;
    }): Promise<void> => {
      try {
        const body: any = {
          channel: params.conversationId,
          text: params.content,
        };
        
        if (params.replyToMessageId) {
          body.thread_ts = params.replyToMessageId;
        }
        
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.connectorConfig.botToken}`,
          },
          body: JSON.stringify(body),
        });
        
        const result = await response.json() as any;
        if (!result.ok) {
          throw new Error(result.error || '发送消息失败');
        }
        
        console.log('[SlackConnector] ✅ 消息已发送');
      } catch (error) {
        console.error('[SlackConnector] ❌ 发送消息失败:', error);
        throw error;
      }
    },
    
    sendImage: async (params: {
      conversationId: string;
      imagePath: string;
      caption?: string;
      replyToMessageId?: string;
    }): Promise<void> => {
      try {
        // 上传图片到 Slack
        const imageBuffer = fs.readFileSync(params.imagePath);
        const fileName = path.basename(params.imagePath);
        
        const formData = new FormData();
        const uint8Array = new Uint8Array(imageBuffer);
        formData.append('file', new Blob([uint8Array]), fileName);
        formData.append('channels', params.conversationId);
        
        if (params.caption) {
          formData.append('initial_comment', params.caption);
        }
        
        const response = await fetch('https://slack.com/api/files.upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.connectorConfig.botToken}`,
          },
          body: formData,
        });
        
        const result = await response.json() as any;
        if (!result.ok) {
          throw new Error(result.error || '发送图片失败');
        }
        
        console.log('[SlackConnector] ✅ 图片已发送');
      } catch (error) {
        console.error('[SlackConnector] ❌ 发送图片失败:', error);
        throw error;
      }
    },
    
    sendFile: async (params: {
      conversationId: string;
      filePath: string;
      fileName?: string;
      replyToMessageId?: string;
    }): Promise<void> => {
      try {
        const fileBuffer = fs.readFileSync(params.filePath);
        const fileName = params.fileName || path.basename(params.filePath);
        
        const formData = new FormData();
        const uint8Array = new Uint8Array(fileBuffer);
        formData.append('file', new Blob([uint8Array]), fileName);
        formData.append('channels', params.conversationId);
        
        const response = await fetch('https://slack.com/api/files.upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.connectorConfig.botToken}`,
          },
          body: formData,
        });
        
        const result = await response.json() as any;
        if (!result.ok) {
          throw new Error(result.error || '发送文件失败');
        }
        
        console.log('[SlackConnector] ✅ 文件已发送');
      } catch (error) {
        console.error('[SlackConnector] ❌ 发送文件失败:', error);
        throw error;
      }
    },
  };
  
  /**
   * 配对批准后发送欢迎消息
   */
  onPairingApproved(userId: string): void {
    this.outbound.sendMessage({
      conversationId: userId,
      content: '✅ Authorization complete! You can now chat with DeepBot.\n\nSend "help" to get started.',
    }).catch(() => {});
  }
  
  // ========== Pairing 机制 ==========
  
  pairing = {
    generatePairingCode: (userId: string, userName?: string): string => {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const store = SystemConfigStore.getInstance();
      const existingRecords = store.getAllPairingRecords('slack');
      const isFirstUser = existingRecords.length === 0;
      
      store.savePairingRecord('slack', userId, code, userName);
      
      if (isFirstUser) {
        store.approvePairingRecord(code);
        store.setAdminPairing('slack', userId, true);
        this.connectorManager.notifyPairingApproved('slack', userId);
      } else {
        this.connectorManager.broadcastPendingCount();
      }
      
      return code;
    },
    
    verifyPairingCode: (userId: string): boolean => {
      const store = SystemConfigStore.getInstance();
      const record = store.getPairingRecordByUser('slack', userId);
      return record?.approved ?? false;
    },
    
    approvePairing: async (code: string): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.approvePairingRecord(code);
    },
  };
}

/**
 * Slack Socket Mode 客户端
 * 
 * 实现与 Slack 的 WebSocket 长连接通信
 */
class SlackSocketClient extends EventEmitter {
  private config: { appToken: string; botToken: string };
  private ws?: WebSocket;
  private isConnected_: boolean = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  
  // Slack Socket Mode 端点
  private static readonly WEBSOCKET_URL = 'wss://wss-primary.slack.com/socket';
  
  constructor(config: { appToken: string; botToken: string }) {
    super();
    this.config = config;
  }
  
  isConnected(): boolean {
    return this.isConnected_;
  }
  
  async start(): Promise<void> {
    try {
      // 获取 WebSocket 连接 URL
      const wsUrl = await this.getWebSocketUrl();
      
      // 建立 WebSocket 连接
      await this.connect(wsUrl);
      
      console.log('[SlackSocket] ✅ Socket Mode 连接已建立');
    } catch (error) {
      console.error('[SlackSocket] ❌ 启动失败:', error);
      throw error;
    }
  }
  
  stop(): void {
    this.cleanup();
    this.isConnected_ = false;
    console.log('[SlackSocket] 连接已停止');
  }
  
  /**
   * 获取 WebSocket 连接 URL
   */
  private async getWebSocketUrl(): Promise<string> {
    const response = await fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.appToken}`,
      },
    });
    
    const data = await response.json() as any;
    if (!data.ok) {
      throw new Error(data.error || '获取 WebSocket URL 失败');
    }
    
    return data.url;
  }
  
  /**
   * 建立 WebSocket 连接
   */
  private async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        
        ws.on('open', () => {
          console.log('[SlackSocket] WebSocket 连接已打开');
          this.isConnected_ = true;
          this.startHeartbeat();
          resolve();
        });
        
        ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });
        
        ws.on('error', (error) => {
          console.error('[SlackSocket] WebSocket 错误:', error);
          this.emit('error', error);
        });
        
        ws.on('close', () => {
          console.log('[SlackSocket] WebSocket 连接已关闭');
          this.isConnected_ = false;
          this.scheduleReconnect();
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 处理接收到的消息
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      // 处理连接确认
      if (message.type === 'hello') {
        console.log('[SlackSocket] 收到连接确认');
        return;
      }
      
      // 处理心跳/keepalive
      if (message.type === 'disconnect' && message.reason === 'warning') {
        console.warn('[SlackSocket] 收到警告:', message);
        return;
      }
      
      // 触发消息事件
      this.emit('message', message);
      
    } catch (error) {
      console.error('[SlackSocket] 解析消息失败:', error);
    }
  }
  
  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Slack 不需要显式心跳，但保持连接活跃
      }
    }, 30000);
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.cleanup();
    
    this.reconnectTimer = setTimeout(() => {
      console.log('[SlackSocket] 尝试重新连接...');
      this.start().catch((error) => {
        console.error('[SlackSocket] 重连失败:', error);
      });
    }, 5000);
  }
  
  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch (e) {
        // 忽略关闭错误
      }
      this.ws = undefined;
    }
  }
}
