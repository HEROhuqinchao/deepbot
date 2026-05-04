/**
 * 企微客服连接器
 * 
 * 通过 WebSocket 连接 wechat-service 接收企微客服消息
 * 支持认证、心跳、自动重连
 */

import type {
  Connector,
  WecomKfConnectorConfig,
  WecomKfIncomingMessage,
  HealthStatus,
} from '../../../types/connector';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import type { ConnectorManager } from '../connector-manager';
import { SystemConfigStore } from '../../database/system-config-store';

export class WecomKfConnector implements Connector {
  readonly id = 'wecom-kf' as const;
  readonly name = '企微客服';
  readonly version = '1.0.0';

  private connectorConfig!: WecomKfConnectorConfig;
  private connectorManager: ConnectorManager;
  private isStarted: boolean = false;
  private ws: any = null; // WebSocket 实例（动态导入）
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // 消息去重
  private processedMessages: Set<string> = new Set();
  private readonly MAX_PROCESSED_MESSAGES = 1000;

  constructor(connectorManager: ConnectorManager) {
    this.connectorManager = connectorManager;
  }

  // ========== 配置管理 ==========
  config = {
    load: async (): Promise<WecomKfConnectorConfig | null> => {
      const store = SystemConfigStore.getInstance();
      const result = store.getConnectorConfig(this.id);
      if (!result) return null;
      return { ...result.config, enabled: result.enabled } as WecomKfConnectorConfig;
    },

    save: async (config: WecomKfConnectorConfig): Promise<void> => {
      const store = SystemConfigStore.getInstance();
      store.saveConnectorConfig(this.id, this.name, config, false);
    },

    validate: (config: WecomKfConnectorConfig): boolean => {
      return !!(config.wsUrl && config.wsKey);
    },
  };

  // ========== 生命周期 ==========

  async initialize(config: WecomKfConnectorConfig): Promise<void> {
    this.connectorConfig = config;
    console.log('[WecomKfConnector] ✅ 初始化完成');
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      console.log('[WecomKfConnector] 已在运行中');
      return;
    }

    console.log('[WecomKfConnector] 🔄 启动企微客服连接器...');
    this.isStarted = true;
    await this.connect();
    console.log('[WecomKfConnector] ✅ 企微客服连接器已启动');
  }

  async stop(): Promise<void> {
    this.isStarted = false;
    this.clearTimers();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // 静默处理
      }
      this.ws = null;
    }

    console.log('[WecomKfConnector] ✅ 企微客服连接器已停止');
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.isStarted || !this.ws) {
      return { status: 'unhealthy', message: '企微客服连接器未运行' };
    }

    // WebSocket readyState: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
    if (this.ws.readyState !== 1) {
      return { status: 'unhealthy', message: 'WebSocket 未连接' };
    }

    return { status: 'healthy', message: '企微客服连接器运行正常' };
  }

  // ========== 消息发送 ==========

  outbound = {
    sendMessage: async (params: {
      conversationId: string;
      content: string;
      replyToMessageId?: string;
    }): Promise<void> => {
      if (!this.ws || this.ws.readyState !== 1) {
        throw new Error('WebSocket 未连接');
      }

      // 从 conversationId 中解析 external_userid 和 open_kfid
      // conversationId 格式: {external_userid}||{open_kfid}
      const parts = params.conversationId.split('||');
      const externalUserId = parts[0];
      const openKfId = parts[1] || '';

      this.ws.send(JSON.stringify({
        type: 'send_message',
        touser: externalUserId,
        open_kfid: openKfId,
        content: params.content,
        msgid: params.replyToMessageId,
      }));
    },
  };

  // ========== 内部方法 ==========

  /**
   * 连接 WebSocket
   */
  private async connect(): Promise<void> {
    if (!this.isStarted) return;

    console.log('[WecomKfConnector] 🔌 正在连接 WebSocket...');

    try {
      // 动态导入 ws 模块
      const WebSocket = require('ws');
      this.ws = new WebSocket(this.connectorConfig.wsUrl);

      this.ws.on('open', () => {
        console.log('[WecomKfConnector] ✅ WebSocket 连接成功');

        // 发送认证
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonce = Math.random().toString(36).substr(2, 8);

        this.ws.send(JSON.stringify({
          type: 'auth',
          key: this.connectorConfig.wsKey,
          timestamp,
          nonce,
        }));
      });

      this.ws.on('message', (data: any) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWsMessage(message);
        } catch (err) {
          console.error('[WecomKfConnector] ❌ 消息解析失败:', getErrorMessage(err));
        }
      });

      this.ws.on('close', () => {
        console.log('[WecomKfConnector] 🔌 WebSocket 连接已关闭');
        this.clearTimers();

        // 自动重连
        if (this.isStarted) {
          this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        }
      });

      this.ws.on('error', (err: any) => {
        console.error('[WecomKfConnector] ❌ WebSocket 错误:', getErrorMessage(err));
      });
    } catch (error) {
      console.error('[WecomKfConnector] ❌ 连接失败:', getErrorMessage(error));
      // 自动重连
      if (this.isStarted) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleWsMessage(message: any): void {
    const { type } = message;

    switch (type) {
      case 'auth_success':
        console.log('[WecomKfConnector] ✅ 认证成功，Client ID:', message.clientId);
        this.startHeartbeat();
        break;

      case 'auth_failed':
        console.error('[WecomKfConnector] ❌ 认证失败:', message.error);
        this.ws?.close();
        break;

      case 'pong':
        // 心跳响应，静默处理
        break;

      case 'new_messages':
        if (message.messages && Array.isArray(message.messages)) {
          for (const m of message.messages) {
            this.handleIncomingMessage(m).catch((error) => {
              console.error('[WecomKfConnector] ❌ 处理消息失败:', getErrorMessage(error));
            });
          }
        }
        break;

      case 'message_sent':
        console.log('[WecomKfConnector] ✅ 消息发送成功:', message.content?.substring(0, 50));
        break;

      case 'error':
        console.error('[WecomKfConnector] ❌ 服务端错误:', message.error);
        break;

      default:
        console.log('[WecomKfConnector] 📨 收到未知消息类型:', type);
    }
  }

  /**
   * 处理收到的企微客服消息
   */
  private async handleIncomingMessage(msg: any): Promise<void> {
    try {
      const msgId = msg.msgid || `${msg.external_userid}-${msg.send_time}`;

      // 消息去重
      if (this.processedMessages.has(msgId)) return;
      this.processedMessages.add(msgId);
      if (this.processedMessages.size > this.MAX_PROCESSED_MESSAGES) {
        const first = this.processedMessages.values().next().value;
        if (first) this.processedMessages.delete(first);
      }

      // 跳过事件类型消息（如用户进入会话等）
      if (msg.msgtype === 'event') {
        console.log('[WecomKfConnector] 📌 跳过事件消息:', msg.event?.event_type);
        return;
      }

      // 提取消息文本
      let text = '';
      if (msg.msgtype === 'text') {
        text = msg.text?.content || '';
      } else if (msg.msgtype === 'image') {
        text = '[图片]';
      } else if (msg.msgtype === 'miniprogram') {
        text = msg.miniprogram?.title || '[小程序]';
      } else if (msg.msgtype === 'link') {
        text = msg.link?.title || '[链接]';
      } else if (msg.msgtype === 'location') {
        text = `[位置: ${msg.location?.x}, ${msg.location?.y}]`;
      } else {
        text = `[${msg.msgtype || '未知类型'}]`;
      }

      // 跳过空消息
      if (!text) return;

      const nickname = msg.nickname || '未知用户';
      const kfName = msg.kf_name || msg.open_kfid || '未知客服';
      const externalUserId = msg.external_userid || '';
      const openKfId = msg.open_kfid || '';

      // 构建内部消息格式
      // conversationId 使用 external_userid + open_kfid 组合，确保同一客户在同一客服下的消息路由到同一 Tab
      // 使用 || 作为分隔符，避免与 ID 中可能存在的 _ 或 - 冲突
      const conversationId = `${externalUserId}||${openKfId}`;

      const parsedMessage: WecomKfIncomingMessage = {
        messageId: msgId,
        timestamp: (msg.send_time || Math.floor(Date.now() / 1000)) * 1000,
        sender: {
          id: externalUserId,
          name: nickname,
        },
        conversation: {
          id: conversationId,
          type: 'p2p',
        },
        content: {
          // 企微客服只支持 text 和 image 类型，其他类型统一映射为 text
          type: msg.msgtype === 'image' ? 'image' : 'text',
          text,
        },
        raw: msg,
      };

      // 转发到 ConnectorManager
      await this.connectorManager.handleIncomingMessage(this.id, parsedMessage);
    } catch (error) {
      console.error('[WecomKfConnector] ❌ 处理消息失败:', getErrorMessage(error));
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    console.log('[WecomKfConnector] ✅ 心跳已启动（30秒间隔）');
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 清除所有定时器
   */
  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
