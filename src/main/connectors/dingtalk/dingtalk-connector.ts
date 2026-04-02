/**
 * 钉钉连接器
 * 
 * 使用钉钉开放平台 Stream 模式建立 WebSocket 长连接接收消息
 * 
 * 参考：
 * - https://open.dingtalk.com/document/development/introduction-to-stream-mode
 * - https://open.dingtalk.com/document/orgapp/the-use-of-internal-application-robots-in-person-to-person-single-chat
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  Connector,
  DingTalkConnectorConfig,
  DingTalkIncomingMessage,
  HealthStatus,
} from '../../../types/connector';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { ensureDirectoryExists } from '../../../shared/utils/fs-utils';
import type { ConnectorManager } from '../connector-manager';
import { SystemConfigStore } from '../../database/system-config-store';
import { DingTalkStreamClient } from './stream-client';


export class DingTalkConnector implements Connector {
  readonly id = 'dingtalk' as const;
  readonly name = '钉钉';
  readonly version = '1.0.0';
  
  private connectorConfig!: DingTalkConnectorConfig;
  private streamClient?: DingTalkStreamClient;
  private connectorManager: ConnectorManager;
  private isStarted: boolean = false;
  
  // 消息去重：缓存最近 1000 条已处理的消息 ID
  private processedMessages: Set<string> = new Set();
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  
  // 基于内容的去重：缓存最近的消息内容和时间戳
  private recentMessages: Map<string, number> = new Map();
  private readonly MESSAGE_DEDUP_WINDOW = 5000; // 5秒内相同内容视为重复
  
  constructor(connectorManager: ConnectorManager) {
    this.connectorManager = connectorManager;
  }
  
  // ========== 配置管理 ==========
  config = {
    load: async (): Promise<DingTalkConnectorConfig | null> => {
      const store = SystemConfigStore.getInstance();
      const result = store.getConnectorConfig('dingtalk');
      
      if (!result) {
        return null;
      }
      
      return {
        ...result.config,
        enabled: result.enabled,
      } as DingTalkConnectorConfig;
    },
    
    save: async (config: DingTalkConnectorConfig): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.saveConnectorConfig('dingtalk', '钉钉', config, false);
    },
    
    validate: (config: DingTalkConnectorConfig): boolean => {
      return !!(
        config.clientId &&
        config.clientSecret
      );
    },
  };
  
  // ========== 生命周期 ==========
  
  async initialize(config: DingTalkConnectorConfig): Promise<void> {
    this.connectorConfig = config;
    console.log('[DingTalkConnector] 初始化完成');
  }
  
  async start(): Promise<void> {
    if (this.isStarted) {
      console.log('[DingTalkConnector] ⚠️ 连接器已启动，跳过重复启动');
      return;
    }
    
    console.log('[DingTalkConnector] 🚀 开始启动钉钉连接器...');
    
    // 初始化 Stream 客户端
    this.streamClient = new DingTalkStreamClient({
      clientId: this.connectorConfig.clientId,
      clientSecret: this.connectorConfig.clientSecret,
    });
    
    // 注册消息回调
    this.streamClient.on('message', (data: any) => {
      this.handleIncomingMessage(data).catch((error) => {
        console.error('[DingTalkConnector] ❌ 处理消息失败:', error);
      });
    });
    
    // 启动连接
    await this.streamClient.start();
    this.isStarted = true;
    
    console.log('[DingTalkConnector] ✅ 连接器已启动');
  }
  
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    console.log('[DingTalkConnector] 🛑 停止连接器...');
    
    if (this.streamClient) {
      this.streamClient.stop();
      this.streamClient = undefined;
    }
    
    this.isStarted = false;
    console.log('[DingTalkConnector] ✅ 连接器已停止');
  }
  
  async healthCheck(): Promise<HealthStatus> {
    if (this.isStarted && this.streamClient?.isConnected()) {
      return {
        status: 'healthy',
        message: '连接正常',
      };
    }
    
    return {
      status: 'unhealthy',
      message: this.streamClient ? '连接器未完全启动' : 'Stream 未连接',
    };
  }
  
  // ========== 消息处理 ==========
  
  /**
   * 获取临时上传目录路径
   */
  private getTempUploadDir(): string {
    const store = SystemConfigStore.getInstance();
    const settings = store.getWorkspaceSettings();
    const tempDir = path.join(settings.workspaceDir, '.deepbot', 'temp', 'uploads');
    ensureDirectoryExists(tempDir);
    return tempDir;
  }
  
  /**
   * 处理接收到的消息
   */
  private async handleIncomingMessage(event: any): Promise<void> {
    try {
      // 解析钉钉消息格式
      // 参考: https://open.dingtalk.com/document/orgapp/receive-message
      const senderId = event.senderId || event.sender?.senderId;
      const senderName = event.senderNick || event.sender?.senderNick || `用户_${senderId?.slice(-8)}`;
      const conversationId = event.conversationId || event.chatId;
      const conversationType = event.conversationType || 'p2p';
      const messageId = event.messageId || event.msgId;
      const msgType = event.msgType || event.messageType || 'text';
      const content = event.content || event.text || '';
      
      // 构建内部消息格式
      const dingtalkMessage: DingTalkIncomingMessage = {
        messageId,
        timestamp: Date.now(),
        sender: {
          id: senderId,
          name: senderName,
        },
        conversation: {
          id: conversationId,
          type: conversationType === 'group' ? 'group' : 'p2p',
        },
        content: {
          type: msgType === 'picture' ? 'image' : msgType === 'file' ? 'file' : 'text',
          text: content,
        },
        mentions: {
          isBotMentioned: this.checkBotMention(event),
          mentionList: event.atUserIds || [],
        },
        raw: event,
      };
      
      // 消息去重
      if (this.processedMessages.has(dingtalkMessage.messageId)) {
        return;
      }
      
      // 基于内容的去重
      const contentKey = `${dingtalkMessage.sender.id}:${dingtalkMessage.content.text}`;
      const now = Date.now();
      const lastTime = this.recentMessages.get(contentKey);
      
      if (lastTime && (now - lastTime) < this.MESSAGE_DEDUP_WINDOW) {
        return;
      }
      
      // 更新去重缓存
      this.processedMessages.add(dingtalkMessage.messageId);
      this.recentMessages.set(contentKey, now);
      
      // 限制缓存大小
      if (this.processedMessages.size > this.MAX_PROCESSED_MESSAGES) {
        const firstItem = this.processedMessages.values().next().value;
        if (firstItem) {
          this.processedMessages.delete(firstItem);
        }
      }
      
      // 清理过期的内容缓存
      for (const [key, timestamp] of this.recentMessages.entries()) {
        if (now - timestamp > this.MESSAGE_DEDUP_WINDOW) {
          this.recentMessages.delete(key);
        }
      }
      
      // 安全检查
      if (!this.checkSecurity(dingtalkMessage)) {
        // 私聊未配对：发送配对码
        if (dingtalkMessage.conversation.type === 'p2p') {
          const code = this.pairing!.generatePairingCode(
            dingtalkMessage.sender.id,
            dingtalkMessage.sender.name
          );
          
          const store = SystemConfigStore.getInstance();
          const record = store.getPairingRecordByUser('dingtalk', dingtalkMessage.sender.id);
          if (record?.approved) {
            dingtalkMessage.systemContext = `[系统通知] 这是第一次有用户连接到 DeepBot。该用户已被自动设置为管理员。`;
            await this.connectorManager.handleIncomingMessage('dingtalk', dingtalkMessage);
            return;
          }
          
          await this.outbound.sendMessage({
            conversationId: dingtalkMessage.conversation.id,
            content: `请使用配对码进行授权：${code}\n\n管理员可以使用以下命令批准：\ndeepbot pairing approve dingtalk ${code}`,
          });
        }
        return;
      }
      
      // 转发到 ConnectorManager
      await this.connectorManager.handleIncomingMessage('dingtalk', dingtalkMessage);
      
    } catch (error) {
      console.error('[DingTalkConnector] ❌ 处理消息失败:', error);
    }
  }
  
  /**
   * 检查是否 @ 了机器人
   */
  private checkBotMention(event: any): boolean {
    const atUserIds = event.atUserIds || [];
    const atMobiles = event.atMobiles || [];
    return atUserIds.length > 0 || atMobiles.length > 0 || event.isInAtList === true;
  }
  
  /**
   * 安全检查
   */
  private checkSecurity(message: DingTalkIncomingMessage): boolean {
    // 私聊：根据配置决定是否需要配对授权
    if (message.conversation.type === 'p2p') {
      if (this.connectorConfig.requirePairing !== true) {
        this.autoApproveUser(message.sender.id, message.sender.name);
        return true;
      }
      return this.pairing!.verifyPairingCode(message.sender.id);
    }
    
    // 群组：检查是否 @ 了机器人
    if (!message.mentions?.isBotMentioned) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 自动批准用户
   */
  private autoApproveUser(userId: string, userName?: string): void {
    const store = SystemConfigStore.getInstance();
    if (store.getPairingRecordByUser('dingtalk', userId)) return;
    
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const isFirstUser = store.getAllPairingRecords('dingtalk').length === 0;
    
    store.savePairingRecord('dingtalk', userId, code, userName);
    store.approvePairingRecord(code);
    
    if (isFirstUser) {
      store.setAdminPairing('dingtalk', userId, true);
    }
    
    console.log('[DingTalkConnector] 🔓 免配对模式：用户已自动加入', { userId, userName });
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
        if (!this.streamClient) {
          throw new Error('Stream 客户端未初始化');
        }
        
        // 使用钉钉 API 发送消息
        // 参考: https://open.dingtalk.com/document/dingstart/the-application-robot-in-the-enterprise-sends-a-single-chat
        await this.streamClient.sendMessage({
          conversationId: params.conversationId,
          content: params.content,
          msgType: 'text',
        });
        
        console.log('[DingTalkConnector] ✅ 消息已发送');
      } catch (error) {
        console.error('[DingTalkConnector] ❌ 发送消息失败:', error);
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
        if (!this.streamClient) {
          throw new Error('Stream 客户端未初始化');
        }
        
        // 读取图片并上传
        const imageBuffer = fs.readFileSync(params.imagePath);
        const uploadResult = await this.streamClient.uploadMedia({
          type: 'image',
          media: imageBuffer,
        });
        
        // 发送图片消息
        await this.streamClient.sendMessage({
          conversationId: params.conversationId,
          content: JSON.stringify({ mediaId: uploadResult.mediaId }),
          msgType: 'picture',
        });
        
        // 发送说明文字
        if (params.caption) {
          await this.outbound.sendMessage({
            conversationId: params.conversationId,
            content: params.caption,
          });
        }
        
        console.log('[DingTalkConnector] ✅ 图片已发送');
      } catch (error) {
        console.error('[DingTalkConnector] ❌ 发送图片失败:', error);
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
        if (!this.streamClient) {
          throw new Error('Stream 客户端未初始化');
        }
        
        // 读取文件并上传
        const fileBuffer = fs.readFileSync(params.filePath);
        const fileName = params.fileName || path.basename(params.filePath);
        
        const uploadResult = await this.streamClient.uploadMedia({
          type: 'file',
          media: fileBuffer,
          fileName,
        });
        
        // 发送文件消息
        await this.streamClient.sendMessage({
          conversationId: params.conversationId,
          content: JSON.stringify({ mediaId: uploadResult.mediaId, fileName }),
          msgType: 'file',
        });
        
        console.log('[DingTalkConnector] ✅ 文件已发送');
      } catch (error) {
        console.error('[DingTalkConnector] ❌ 发送文件失败:', error);
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
      content: '✅ 授权完成，你可以开始和 DeepBot 对话了。\n\n发送「你能做什么」获取使用帮助。',
    }).catch(() => {});
  }
  
  // ========== Pairing 机制 ==========
  
  pairing = {
    generatePairingCode: (userId: string, userName?: string): string => {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const store = SystemConfigStore.getInstance();
      const existingRecords = store.getAllPairingRecords('dingtalk');
      const isFirstUser = existingRecords.length === 0;
      
      store.savePairingRecord('dingtalk', userId, code, userName);
      
      if (isFirstUser) {
        store.approvePairingRecord(code);
        store.setAdminPairing('dingtalk', userId, true);
        this.connectorManager.notifyPairingApproved('dingtalk', userId);
      } else {
        this.connectorManager.broadcastPendingCount();
      }
      
      return code;
    },
    
    verifyPairingCode: (userId: string): boolean => {
      const store = SystemConfigStore.getInstance();
      const record = store.getPairingRecordByUser('dingtalk', userId);
      return record?.approved ?? false;
    },
    
    approvePairing: async (code: string): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.approvePairingRecord(code);
    },
  };
}
