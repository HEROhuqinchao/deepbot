/**
 * 企业微信连接器
 * 
 * 使用企业微信智能机器人长连接模式接收消息
 * 
 * 参考：
 * - https://developer.work.weixin.qq.com/document/path/101039
 * - https://developer.work.weixin.qq.com/document/path/101463
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import type {
  Connector,
  WeComConnectorConfig,
  WeComIncomingMessage,
  HealthStatus,
} from '../../../types/connector';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { ensureDirectoryExists } from '../../../shared/utils/fs-utils';
import type { ConnectorManager } from '../connector-manager';
import { SystemConfigStore } from '../../database/system-config-store';
import { EventEmitter } from 'events';


export class WeComConnector implements Connector {
  readonly id = 'wecom' as const;
  readonly name = '企业微信';
  readonly version = '1.0.0';
  
  private connectorConfig!: WeComConnectorConfig;
  private wsClient?: WeComWSClient;
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
    load: async (): Promise<WeComConnectorConfig | null> => {
      const store = SystemConfigStore.getInstance();
      const result = store.getConnectorConfig('wecom');
      
      if (!result) {
        return null;
      }
      
      return {
        ...result.config,
        enabled: result.enabled,
      } as WeComConnectorConfig;
    },
    
    save: async (config: WeComConnectorConfig): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.saveConnectorConfig('wecom', '企业微信', config, false);
    },
    
    validate: (config: WeComConnectorConfig): boolean => {
      return !!(
        config.corpId &&
        config.agentId &&
        config.secret
      );
    },
  };
  
  // ========== 生命周期 ==========
  
  async initialize(config: WeComConnectorConfig): Promise<void> {
    this.connectorConfig = config;
    console.log('[WeComConnector] 初始化完成');
  }
  
  async start(): Promise<void> {
    if (this.isStarted) {
      console.log('[WeComConnector] ⚠️ 连接器已启动，跳过重复启动');
      return;
    }
    
    console.log('[WeComConnector] 🚀 开始启动企业微信连接器...');
    console.log('[WeComConnector]   Corp ID:', this.connectorConfig.corpId.substring(0, 10) + '...');
    console.log('[WeComConnector]   Agent ID:', this.connectorConfig.agentId);
    console.log('[WeComConnector]   Require Pairing:', this.connectorConfig.requirePairing);
    
    try {
      // 初始化 WebSocket 客户端
      this.wsClient = new WeComWSClient({
        corpId: this.connectorConfig.corpId,
        agentId: this.connectorConfig.agentId,
        secret: this.connectorConfig.secret,
      });
      
      // 注册消息回调
      this.wsClient.on('message', (data: any) => {
        this.handleIncomingMessage(data).catch((error) => {
          console.error('[WeComConnector] ❌ 处理消息失败:', error);
        });
      });
      
      // 注册错误回调
      this.wsClient.on('error', (error: any) => {
        console.error('[WeComConnector] ❌ WebSocket 客户端错误:', error);
      });
      
      // 启动连接
      await this.wsClient.start();
      this.isStarted = true;
      
      console.log('[WeComConnector] ✅ 连接器已启动');
    } catch (error) {
      console.error('[WeComConnector] ❌ 启动失败:', error);
      throw error;
    }
  }
  
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    console.log('[WeComConnector] 🛑 停止连接器...');
    
    if (this.wsClient) {
      this.wsClient.stop();
      this.wsClient = undefined;
    }
    
    this.isStarted = false;
    console.log('[WeComConnector] ✅ 连接器已停止');
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
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.connectorConfig.corpId}&corpsecret=${this.connectorConfig.secret}`;
    
    const response = await fetch(url);
    const data = await response.json() as any;
    
    if (data.errcode !== 0) {
      throw new Error(data.errmsg || '获取 Access Token 失败');
    }
    
    this.accessToken = data.access_token;
    // 提前 5 分钟过期
    this.accessTokenExpireAt = Date.now() + ((data.expires_in || 7200) - 300) * 1000;
    
    return this.accessToken!;
  }
  
  // ========== 消息处理 ==========
  
  private async handleIncomingMessage(event: any): Promise<void> {
    try {
      // 企业微信智能机器人消息格式
      // 参考: https://developer.work.weixin.qq.com/document/path/101463
      const cmd = event.cmd;
      
      if (cmd !== 'aibot_msg_callback') {
        return;
      }
      
      const msgData = event.data || event;
      
      // 解析消息
      const messageId = msgData.msg_id || msgData.MsgId;
      const senderId = msgData.from_userid || msgData.FromUserId;
      const conversationId = msgData.chat_id || msgData.ChatId;
      const msgType = msgData.msg_type || msgData.MsgType;
      const text = msgData.text || msgData.Text || '';
      
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
      
      // 判断是否群聊
      const isGroup = conversationId && !conversationId.startsWith('wm_');
      
      // 构建内部消息格式
      const wecomMessage: WeComIncomingMessage = {
        messageId,
        timestamp: Date.now(),
        sender: {
          id: senderId,
          name: `用户_${senderId?.slice(-8)}`,
        },
        conversation: {
          id: conversationId || senderId,
          type: isGroup ? 'group' : 'p2p',
        },
        content: {
          type: msgType === 'image' ? 'image' : msgType === 'file' ? 'file' : 'text',
          text,
        },
        mentions: {
          isBotMentioned: this.checkBotMention(msgData),
          mentionList: [],
        },
        raw: event,
      };
      
      // 安全检查
      if (!this.checkSecurity(wecomMessage)) {
        if (wecomMessage.conversation.type === 'p2p') {
          const code = this.pairing!.generatePairingCode(
            wecomMessage.sender.id,
            wecomMessage.sender.name
          );
          
          const store = SystemConfigStore.getInstance();
          const record = store.getPairingRecordByUser('wecom', wecomMessage.sender.id);
          if (record?.approved) {
            wecomMessage.systemContext = `[系统通知] 这是第一次有用户连接到 史丽慧小助理。`;
            await this.connectorManager.handleIncomingMessage('wecom', wecomMessage);
            return;
          }
          
          await this.outbound.sendMessage({
            conversationId: wecomMessage.conversation.id,
            content: `请使用配对码进行授权：${code}\n\n管理员可以使用以下命令批准：\nslhbot pairing approve wecom ${code}`,
          });
        }
        return;
      }
      
      // 转发到 ConnectorManager
      await this.connectorManager.handleIncomingMessage('wecom', wecomMessage);
      
    } catch (error) {
      console.error('[WeComConnector] ❌ 处理消息失败:', error);
    }
  }
  
  /**
   * 检查是否 @ 了机器人
   */
  private checkBotMention(msgData: any): boolean {
    return msgData.is_at_bot === true || msgData.at_bot === true;
  }
  
  /**
   * 安全检查
   */
  private checkSecurity(message: WeComIncomingMessage): boolean {
    if (message.conversation.type === 'p2p') {
      if (this.connectorConfig.requirePairing !== true) {
        this.autoApproveUser(message.sender.id, message.sender.name);
        return true;
      }
      return this.pairing!.verifyPairingCode(message.sender.id);
    }
    
    // 群聊需要 @ 机器人
    return message.mentions?.isBotMentioned ?? false;
  }
  
  /**
   * 自动批准用户
   */
  private autoApproveUser(userId: string, userName?: string): void {
    const store = SystemConfigStore.getInstance();
    if (store.getPairingRecordByUser('wecom', userId)) return;
    
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const isFirstUser = store.getAllPairingRecords('wecom').length === 0;
    
    store.savePairingRecord('wecom', userId, code, userName);
    store.approvePairingRecord(code);
    
    if (isFirstUser) {
      store.setAdminPairing('wecom', userId, true);
    }
    
    console.log('[WeComConnector] 🔓 免配对模式：用户已自动加入', { userId, userName });
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
        
        // 判断是单聊还是群聊
        const isGroup = params.conversationId && !params.conversationId.startsWith('wm_');
        
        let url: string;
        let body: any;
        
        if (isGroup) {
          // 群聊消息
          url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
          body = {
            touser: '',
            toparty: '',
            totag: '',
            chatid: params.conversationId,
            msgtype: 'text',
            agentid: this.connectorConfig.agentId,
            text: {
              content: params.content,
            },
            safe: 0,
          };
        } else {
          // 单聊消息
          url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
          body = {
            touser: params.conversationId,
            toparty: '',
            totag: '',
            msgtype: 'text',
            agentid: this.connectorConfig.agentId,
            text: {
              content: params.content,
            },
            safe: 0,
          };
        }
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        
        const result = await response.json() as any;
        if (result.errcode !== 0) {
          throw new Error(result.errmsg || '发送消息失败');
        }
        
        console.log('[WeComConnector] ✅ 消息已发送');
      } catch (error) {
        console.error('[WeComConnector] ❌ 发送消息失败:', error);
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
        formData.append('media', new Blob([uint8Array]), path.basename(params.imagePath));
        formData.append('type', 'image');
        
        const uploadResponse = await fetch(
          `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=image`,
          {
            method: 'POST',
            body: formData,
          }
        );
        
        const uploadResult = await uploadResponse.json() as any;
        if (uploadResult.errcode && uploadResult.errcode !== 0) {
          throw new Error(uploadResult.errmsg || '上传图片失败');
        }
        
        const mediaId = uploadResult.media_id;
        
        // 发送图片消息
        const isGroup = params.conversationId && !params.conversationId.startsWith('wm_');
        
        const body: any = {
          touser: isGroup ? '' : params.conversationId,
          chatid: isGroup ? params.conversationId : '',
          msgtype: 'image',
          agentid: this.connectorConfig.agentId,
          image: {
            media_id: mediaId,
          },
          safe: 0,
        };
        
        const response = await fetch(
          `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        );
        
        const result = await response.json() as any;
        if (result.errcode !== 0) {
          throw new Error(result.errmsg || '发送图片失败');
        }
        
        // 发送说明文字
        if (params.caption) {
          await this.outbound.sendMessage({
            conversationId: params.conversationId,
            content: params.caption,
          });
        }
        
        console.log('[WeComConnector] ✅ 图片已发送');
      } catch (error) {
        console.error('[WeComConnector] ❌ 发送图片失败:', error);
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
        formData.append('media', new Blob([uint8Array]), params.fileName || path.basename(params.filePath));
        formData.append('type', 'file');
        
        const uploadResponse = await fetch(
          `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=file`,
          {
            method: 'POST',
            body: formData,
          }
        );
        
        const uploadResult = await uploadResponse.json() as any;
        if (uploadResult.errcode && uploadResult.errcode !== 0) {
          throw new Error(uploadResult.errmsg || '上传文件失败');
        }
        
        const mediaId = uploadResult.media_id;
        
        // 发送文件消息
        const isGroup = params.conversationId && !params.conversationId.startsWith('wm_');
        
        const body: any = {
          touser: isGroup ? '' : params.conversationId,
          chatid: isGroup ? params.conversationId : '',
          msgtype: 'file',
          agentid: this.connectorConfig.agentId,
          file: {
            media_id: mediaId,
          },
          safe: 0,
        };
        
        const response = await fetch(
          `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        );
        
        const result = await response.json() as any;
        if (result.errcode !== 0) {
          throw new Error(result.errmsg || '发送文件失败');
        }
        
        console.log('[WeComConnector] ✅ 文件已发送');
      } catch (error) {
        console.error('[WeComConnector] ❌ 发送文件失败:', error);
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
      const existingRecords = store.getAllPairingRecords('wecom');
      const isFirstUser = existingRecords.length === 0;
      
      store.savePairingRecord('wecom', userId, code, userName);
      
      if (isFirstUser) {
        store.approvePairingRecord(code);
        store.setAdminPairing('wecom', userId, true);
        this.connectorManager.notifyPairingApproved('wecom', userId);
      } else {
        this.connectorManager.broadcastPendingCount();
      }
      
      return code;
    },
    
    verifyPairingCode: (userId: string): boolean => {
      const store = SystemConfigStore.getInstance();
      const record = store.getPairingRecordByUser('wecom', userId);
      return record?.approved ?? false;
    },
    
    approvePairing: async (code: string): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.approvePairingRecord(code);
    },
  };
}

/**
 * 企业微信 WebSocket 客户端
 * 
 * 实现与企业微信智能机器人的长连接通信
 */
class WeComWSClient extends EventEmitter {
  private config: { corpId: string; agentId: string; secret: string };
  private ws?: WebSocket;
  private isConnected_: boolean = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  
  // 企业微信智能机器人 WebSocket 端点
  private static readonly WEBSOCKET_URL = 'wss://wxwork.weixin.qq.com/wxwork/aibot/connect';
  
  constructor(config: { corpId: string; agentId: string; secret: string }) {
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
      
      console.log('[WeComWS] ✅ WebSocket 连接已建立');
    } catch (error) {
      console.error('[WeComWS] ❌ 启动失败:', error);
      throw error;
    }
  }
  
  stop(): void {
    this.cleanup();
    this.isConnected_ = false;
    console.log('[WeComWS] 连接已停止');
  }
  
  /**
   * 获取 WebSocket 连接 URL
   */
  private async getWebSocketUrl(): Promise<string> {
    // 获取 access_token
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.secret}`;
    
    const response = await fetch(url);
    const data = await response.json() as any;
    
    if (data.errcode !== 0) {
      throw new Error(data.errmsg || '获取 Access Token 失败');
    }
    
    // 构建连接 URL
    // 注意：实际的企业微信智能机器人 WebSocket 接口需要参考官方最新文档
    return `${WeComWSClient.WEBSOCKET_URL}?corpid=${this.config.corpId}&agentid=${this.config.agentId}&access_token=${data.access_token}`;
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
          console.log('[WeComWS] WebSocket 连接已打开');
          this.isConnected_ = true;
          this.startHeartbeat();
          resolve();
        });
        
        ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });
        
        ws.on('error', (error) => {
          console.error('[WeComWS] WebSocket 错误:', error);
          this.emit('error', error);
        });
        
        ws.on('close', () => {
          console.log('[WeComWS] WebSocket 连接已关闭');
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
      
      // 处理心跳响应
      if (message.type === 'pong' || message.cmd === 'pong') {
        return;
      }
      
      // 触发消息事件
      this.emit('message', message);
      
    } catch (error) {
      console.error('[WeComWS] 解析消息失败:', error);
    }
  }
  
  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.cleanup();
    
    this.reconnectTimer = setTimeout(() => {
      console.log('[WeComWS] 尝试重新连接...');
      this.start().catch((error) => {
        console.error('[WeComWS] 重连失败:', error);
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
