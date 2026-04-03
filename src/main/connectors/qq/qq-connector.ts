/**
 * QQ 机器人连接器
 * 
 * 使用 QQ 开放平台官方 API 实现机器人功能
 * 
 * 参考：
 * - https://bot.q.qq.com/wiki/develop/api-v2/
 * - https://github.com/tencentyun/bot-node-sdk
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import type {
  Connector,
  QQConnectorConfig,
  QQIncomingMessage,
  HealthStatus,
} from '../../../types/connector';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { ensureDirectoryExists } from '../../../shared/utils/fs-utils';
import type { ConnectorManager } from '../connector-manager';
import { SystemConfigStore } from '../../database/system-config-store';
import { EventEmitter } from 'events';


export class QQConnector implements Connector {
  readonly id = 'qq' as const;
  readonly name = 'QQ机器人';
  readonly version = '1.0.0';
  
  private connectorConfig!: QQConnectorConfig;
  private wsClient?: QQBotWSClient;
  private connectorManager: ConnectorManager;
  private isStarted: boolean = false;
  
  // 消息去重
  private processedMessages: Set<string> = new Set();
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  
  // Access Token 缓存
  private accessToken?: string;
  private accessTokenExpireAt?: number;
  
  constructor(connectorManager: ConnectorManager) {
    this.connectorManager = connectorManager;
  }
  
  // ========== 配置管理 ==========
  config = {
    load: async (): Promise<QQConnectorConfig | null> => {
      const store = SystemConfigStore.getInstance();
      const result = store.getConnectorConfig('qq');
      
      if (!result) {
        return null;
      }
      
      return {
        ...result.config,
        enabled: result.enabled,
      } as QQConnectorConfig;
    },
    
    save: async (config: QQConnectorConfig): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.saveConnectorConfig('qq', 'QQ机器人', config, false);
    },
    
    validate: (config: QQConnectorConfig): boolean => {
      return !!(
        config.appId &&
        config.appSecret
      );
    },
  };
  
  // ========== 生命周期 ==========
  
  async initialize(config: QQConnectorConfig): Promise<void> {
    this.connectorConfig = config;
    console.log('[QQConnector] 初始化完成');
  }
  
  async start(): Promise<void> {
    if (this.isStarted) {
      console.log('[QQConnector] ⚠️ 连接器已启动，跳过重复启动');
      return;
    }
    
    console.log('[QQConnector] 🚀 开始启动 QQ 机器人连接器...');
    console.log('[QQConnector]   App ID:', this.connectorConfig.appId);
    console.log('[QQConnector]   Require Pairing:', this.connectorConfig.requirePairing);
    
    try {
      // 初始化 WebSocket 客户端
      this.wsClient = new QQBotWSClient({
        appId: this.connectorConfig.appId,
        appSecret: this.connectorConfig.appSecret,
      });
      
      // 注册消息回调
      this.wsClient.on('message', (data: any) => {
        this.handleIncomingMessage(data).catch((error) => {
          console.error('[QQConnector] ❌ 处理消息失败:', error);
        });
      });
      
      // 注册错误回调
      this.wsClient.on('error', (error: any) => {
        console.error('[QQConnector] ❌ WebSocket 客户端错误:', error);
      });
      
      // 启动连接
      await this.wsClient.start();
      this.isStarted = true;
      
      console.log('[QQConnector] ✅ 连接器已启动');
    } catch (error) {
      console.error('[QQConnector] ❌ 启动失败:', error);
      throw error;
    }
  }
  
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    console.log('[QQConnector] 🛑 停止连接器...');
    
    if (this.wsClient) {
      this.wsClient.stop();
      this.wsClient = undefined;
    }
    
    this.isStarted = false;
    console.log('[QQConnector] ✅ 连接器已停止');
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
      message: this.wsClient ? '连接器未完全启动' : 'WebSocket 未连接',
    };
  }
  
  // ========== Access Token 管理 ==========
  
  private async getAccessToken(): Promise<string> {
    // 检查缓存
    if (this.accessToken && this.accessTokenExpireAt && Date.now() < this.accessTokenExpireAt) {
      return this.accessToken;
    }
    
    // 获取新的 Access Token
    // 参考: https://bot.q.qq.com/wiki/develop/api-v2/
    const response = await fetch('https://api.sgroup.qq.com/api/v2/app/getAppAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId: this.connectorConfig.appId,
        appSecret: this.connectorConfig.appSecret,
      }),
    });
    
    const data = await response.json() as any;
    
    if (data.code !== 0 || !data.access_token) {
      throw new Error(data.message || '获取 Access Token 失败');
    }
    
    this.accessToken = data.access_token;
    // 提前 5 分钟过期
    this.accessTokenExpireAt = Date.now() + ((data.expires_in || 7200) - 300) * 1000;
    
    return this.accessToken!;
  }
  
  // ========== 消息处理 ==========
  
  private async handleIncomingMessage(event: any): Promise<void> {
    try {
      // QQ 机器人事件类型
      // 参考: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/group/
      const eventType = event.t || event.type;
      
      // 处理不同类型的事件
      if (eventType === 'GROUP_AT_MESSAGE_CREATE') {
        // 群聊 @ 消息
        await this.processGroupMessage(event);
      } else if (eventType === 'DIRECT_MESSAGE_CREATE') {
        // 私聊消息
        await this.processDirectMessage(event);
      } else if (eventType === 'C2C_MESSAGE_CREATE') {
        // 单聊消息
        await this.processC2CMessage(event);
      }
      
    } catch (error) {
      console.error('[QQConnector] ❌ 处理消息失败:', error);
    }
  }
  
  /**
   * 处理群聊 @ 消息
   */
  private async processGroupMessage(event: any): Promise<void> {
    const d = event.d || event.data || event;
    
    const messageId = d.id || d.message_id;
    const guildId = d.guild_id;
    const channelId = d.channel_id;
    const senderId = d.author?.id;
    const senderName = d.author?.username || `用户_${senderId?.slice(-8)}`;
    const content = this.cleanMessageContent(d.content || d.content || '');
    
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
    
    const qqMessage: QQIncomingMessage = {
      messageId,
      timestamp: Date.now(),
      sender: {
        id: senderId,
        name: senderName,
      },
      conversation: {
        id: channelId || guildId,
        type: 'group',
      },
      content: {
        type: 'text',
        text: content,
      },
      mentions: {
        isBotMentioned: true, // 群聊 @ 消息已经 @ 了机器人
        mentionList: [],
      },
      raw: event,
    };
    
    // 安全检查
    if (!this.checkSecurity(qqMessage)) {
      return;
    }
    
    // 转发到 ConnectorManager
    await this.connectorManager.handleIncomingMessage('qq', qqMessage);
  }
  
  /**
   * 处理私聊消息
   */
  private async processDirectMessage(event: any): Promise<void> {
    const d = event.d || event.data || event;
    
    const messageId = d.id || d.message_id;
    const senderId = d.author?.id;
    const senderName = d.author?.username || `用户_${senderId?.slice(-8)}`;
    const content = this.cleanMessageContent(d.content || '');
    
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
    
    const qqMessage: QQIncomingMessage = {
      messageId,
      timestamp: Date.now(),
      sender: {
        id: senderId,
        name: senderName,
      },
      conversation: {
        id: senderId, // 私聊使用发送者 ID
        type: 'p2p',
      },
      content: {
        type: 'text',
        text: content,
      },
      mentions: {
        isBotMentioned: true,
        mentionList: [],
      },
      raw: event,
    };
    
    // 安全检查
    if (!this.checkSecurity(qqMessage)) {
      const code = this.pairing!.generatePairingCode(
        qqMessage.sender.id,
        qqMessage.sender.name
      );
      
      const store = SystemConfigStore.getInstance();
      const record = store.getPairingRecordByUser('qq', qqMessage.sender.id);
      if (record?.approved) {
        qqMessage.systemContext = `[系统通知] 这是第一次有用户连接到 史丽慧小助理。`;
        await this.connectorManager.handleIncomingMessage('qq', qqMessage);
        return;
      }
      
      await this.outbound.sendMessage({
        conversationId: qqMessage.conversation.id,
        content: `请使用配对码进行授权：${code}\n\n管理员可以使用以下命令批准：\nslhbot pairing approve qq ${code}`,
      });
      return;
    }
    
    // 转发到 ConnectorManager
    await this.connectorManager.handleIncomingMessage('qq', qqMessage);
  }
  
  /**
   * 处理单聊消息
   */
  private async processC2CMessage(event: any): Promise<void> {
    // 单聊消息处理逻辑与私聊类似
    await this.processDirectMessage(event);
  }
  
  /**
   * 清理消息内容（移除 @ 提及等）
   */
  private cleanMessageContent(content: string): string {
    // 移除 <@!xxx> 格式的提及
    return content.replace(/<@!?[0-9]+>/g, '').trim();
  }
  
  /**
   * 安全检查
   */
  private checkSecurity(message: QQIncomingMessage): boolean {
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
    if (store.getPairingRecordByUser('qq', userId)) return;
    
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const isFirstUser = store.getAllPairingRecords('qq').length === 0;
    
    store.savePairingRecord('qq', userId, code, userName);
    store.approvePairingRecord(code);
    
    if (isFirstUser) {
      store.setAdminPairing('qq', userId, true);
    }
    
    console.log('[QQConnector] 🔓 免配对模式：用户已自动加入', { userId, userName });
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
        const accessToken = await this.getAccessToken();
        
        // 判断是群聊还是私聊
        // QQ 机器人需要区分频道群聊和单聊
        
        // 群聊消息
        const response = await fetch(`https://api.sgroup.qq.com/api/v2/channels/${params.conversationId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `QQBot ${accessToken}`,
          },
          body: JSON.stringify({
            content: params.content,
            msg_type: 0, // 文本消息
          }),
        });
        
        const result = await response.json() as any;
        if (result.code && result.code !== 0) {
          throw new Error(result.message || '发送消息失败');
        }
        
        console.log('[QQConnector] ✅ 消息已发送');
      } catch (error) {
        console.error('[QQConnector] ❌ 发送消息失败:', error);
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
        const accessToken = await this.getAccessToken();
        
        // 上传图片
        const imageBuffer = fs.readFileSync(params.imagePath);
        const uint8Array = new Uint8Array(imageBuffer);
        
        const formData = new FormData();
        formData.append('file', new Blob([uint8Array]), path.basename(params.imagePath));
        formData.append('type', '1'); // 图片类型
        
        const uploadResponse = await fetch(
          `https://api.sgroup.qq.com/api/v2/channels/${params.conversationId}/files`,
          {
            method: 'POST',
            headers: {
              'Authorization': `QQBot ${accessToken}`,
            },
            body: formData,
          }
        );
        
        const uploadResult = await uploadResponse.json() as any;
        if (uploadResult.code && uploadResult.code !== 0) {
          throw new Error(uploadResult.message || '上传图片失败');
        }
        
        // 发送图片消息
        const response = await fetch(
          `https://api.sgroup.qq.com/api/v2/channels/${params.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `QQBot ${accessToken}`,
            },
            body: JSON.stringify({
              image: uploadResult.url || uploadResult.file_url,
              msg_type: 1, // 图片消息
            }),
          }
        );
        
        const result = await response.json() as any;
        if (result.code && result.code !== 0) {
          throw new Error(result.message || '发送图片失败');
        }
        
        // 发送说明文字
        if (params.caption) {
          await this.outbound.sendMessage({
            conversationId: params.conversationId,
            content: params.caption,
          });
        }
        
        console.log('[QQConnector] ✅ 图片已发送');
      } catch (error) {
        console.error('[QQConnector] ❌ 发送图片失败:', error);
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
        const accessToken = await this.getAccessToken();
        
        // 上传文件
        const fileBuffer = fs.readFileSync(params.filePath);
        const uint8Array = new Uint8Array(fileBuffer);
        
        const formData = new FormData();
        formData.append('file', new Blob([uint8Array]), params.fileName || path.basename(params.filePath));
        formData.append('type', '2'); // 文件类型
        
        const uploadResponse = await fetch(
          `https://api.sgroup.qq.com/api/v2/channels/${params.conversationId}/files`,
          {
            method: 'POST',
            headers: {
              'Authorization': `QQBot ${accessToken}`,
            },
            body: formData,
          }
        );
        
        const uploadResult = await uploadResponse.json() as any;
        if (uploadResult.code && uploadResult.code !== 0) {
          throw new Error(uploadResult.message || '上传文件失败');
        }
        
        // 发送文件消息
        const response = await fetch(
          `https://api.sgroup.qq.com/api/v2/channels/${params.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `QQBot ${accessToken}`,
            },
            body: JSON.stringify({
              file: uploadResult.url || uploadResult.file_url,
              msg_type: 3, // 文件消息
            }),
          }
        );
        
        const result = await response.json() as any;
        if (result.code && result.code !== 0) {
          throw new Error(result.message || '发送文件失败');
        }
        
        console.log('[QQConnector] ✅ 文件已发送');
      } catch (error) {
        console.error('[QQConnector] ❌ 发送文件失败:', error);
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
      content: '✅ 授权完成，你可以开始和 史丽慧小助理 对话了。\n\n发送「你能做什么」获取使用帮助。',
    }).catch(() => {});
  }
  
  // ========== Pairing 机制 ==========
  
  pairing = {
    generatePairingCode: (userId: string, userName?: string): string => {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const store = SystemConfigStore.getInstance();
      const existingRecords = store.getAllPairingRecords('qq');
      const isFirstUser = existingRecords.length === 0;
      
      store.savePairingRecord('qq', userId, code, userName);
      
      if (isFirstUser) {
        store.approvePairingRecord(code);
        store.setAdminPairing('qq', userId, true);
        this.connectorManager.notifyPairingApproved('qq', userId);
      } else {
        this.connectorManager.broadcastPendingCount();
      }
      
      return code;
    },
    
    verifyPairingCode: (userId: string): boolean => {
      const store = SystemConfigStore.getInstance();
      const record = store.getPairingRecordByUser('qq', userId);
      return record?.approved ?? false;
    },
    
    approvePairing: async (code: string): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.approvePairingRecord(code);
    },
  };
}

/**
 * QQ 机器人 WebSocket 客户端
 * 
 * 实现与 QQ 开放平台的 WebSocket 通信
 */
class QQBotWSClient extends EventEmitter {
  private config: { appId: string; appSecret: string };
  private ws?: WebSocket;
  private isConnected_: boolean = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private seq?: number;
  
  // QQ 机器人 WebSocket 端点
  private static readonly WEBSOCKET_URL = 'wss://api.sgroup.qq.com/websocket';
  
  constructor(config: { appId: string; appSecret: string }) {
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
      
      console.log('[QQBotWS] ✅ WebSocket 连接已建立');
    } catch (error) {
      console.error('[QQBotWS] ❌ 启动失败:', error);
      throw error;
    }
  }
  
  stop(): void {
    this.cleanup();
    this.isConnected_ = false;
    console.log('[QQBotWS] 连接已停止');
  }
  
  /**
   * 获取 WebSocket 连接 URL
   */
  private async getWebSocketUrl(): Promise<string> {
    // QQ 机器人 Gateway API
    const accessToken = await this.getAccessToken();
    
    // 获取 gateway 信息
    const response = await fetch('https://api.sgroup.qq.com/gateway', {
      headers: {
        'Authorization': `QQBot ${accessToken}`,
      },
    });
    
    const data = await response.json() as any;
    if (data.url) {
      return data.url;
    }
    
    // 使用默认 URL
    return QQBotWSClient.WEBSOCKET_URL;
  }
  
  /**
   * 获取 Access Token
   */
  private async getAccessToken(): Promise<string> {
    const response = await fetch('https://api.sgroup.qq.com/api/v2/app/getAppAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
      }),
    });
    
    const data = await response.json() as any;
    if (data.code !== 0 || !data.access_token) {
      throw new Error(data.message || '获取 Access Token 失败');
    }
    
    return data.access_token;
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
          console.log('[QQBotWS] WebSocket 连接已打开');
          this.isConnected_ = true;
          this.startHeartbeat();
          this.sendIdentify();
          resolve();
        });
        
        ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });
        
        ws.on('error', (error) => {
          console.error('[QQBotWS] WebSocket 错误:', error);
          this.emit('error', error);
        });
        
        ws.on('close', () => {
          console.log('[QQBotWS] WebSocket 连接已关闭');
          this.isConnected_ = false;
          this.scheduleReconnect();
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 发送鉴权信息
   */
  private async sendIdentify(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const accessToken = await this.getAccessToken();
    
    this.ws.send(JSON.stringify({
      op: 2, // IDENTIFY
      d: {
        token: `QQBot ${accessToken}`,
        intents: 513, // 接收消息的 intents
        shard: [0, 1],
        properties: {
          $os: process.platform,
          $browser: '史丽慧小助理',
          $device: '史丽慧小助理',
        },
      },
    }));
  }
  
  /**
   * 处理接收到的消息
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      // 处理心跳响应
      if (message.op === 11 || message.op === 'HEARTBEAT_ACK') {
        return;
      }
      
      // 处理 Hello 消息
      if (message.op === 10 || message.op === 'HELLO') {
        this.seq = message.s;
        return;
      }
      
      // 处理 Ready 事件
      if (message.t === 'READY') {
        console.log('[QQBotWS] Bot Ready');
        return;
      }
      
      // 触发消息事件
      this.emit('message', message);
      
    } catch (error) {
      console.error('[QQBotWS] 解析消息失败:', error);
    }
  }
  
  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          op: 1, // HEARTBEAT
          d: this.seq || null,
        }));
      }
    }, 30000);
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.cleanup();
    
    this.reconnectTimer = setTimeout(() => {
      console.log('[QQBotWS] 尝试重新连接...');
      this.start().catch((error) => {
        console.error('[QQBotWS] 重连失败:', error);
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
