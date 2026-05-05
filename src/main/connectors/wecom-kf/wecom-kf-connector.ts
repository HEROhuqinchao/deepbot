/**
 * 企微客服连接器
 * 
 * 通过 WebSocket 连接 wechat-service 接收企微客服消息
 * 支持认证、心跳、自动重连、媒体文件下载
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  Connector,
  WecomKfConnectorConfig,
  WecomKfIncomingMessage,
  HealthStatus,
} from '../../../types/connector';
import { getErrorMessage } from '../../../shared/utils/error-handler';
import { ensureDirectoryExists } from '../../../shared/utils/fs-utils';
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

      await this.sendAndWaitResponse({
        type: 'send_message',
        touser: externalUserId,
        open_kfid: openKfId,
        content: params.content,
        msgid: params.replyToMessageId,
      });
    },

    sendImage: async (params: {
      conversationId: string;
      imagePath: string;
      caption?: string;
    }): Promise<void> => {
      if (!this.ws || this.ws.readyState !== 1) {
        throw new Error('WebSocket 未连接');
      }

      const parts = params.conversationId.split('||');
      const externalUserId = parts[0];
      const openKfId = parts[1] || '';

      // 1. 获取 access_token
      const accessToken = await this.getAccessToken();

      // 2. 上传临时素材获取 media_id
      const mediaId = await this.uploadMedia(accessToken, params.imagePath, 'image');

      // 3. 发送图片消息并等待确认
      await this.sendAndWaitResponse({
        type: 'send_image',
        touser: externalUserId,
        open_kfid: openKfId,
        media_id: mediaId,
      });
    },

    sendFile: async (params: {
      conversationId: string;
      filePath: string;
      fileName?: string;
    }): Promise<void> => {
      if (!this.ws || this.ws.readyState !== 1) {
        throw new Error('WebSocket 未连接');
      }

      const parts = params.conversationId.split('||');
      const externalUserId = parts[0];
      const openKfId = parts[1] || '';

      // 1. 获取 access_token
      const accessToken = await this.getAccessToken();

      // 2. 上传临时素材获取 media_id
      const mediaId = await this.uploadMedia(accessToken, params.filePath, 'file');

      // 3. 发送文件消息并等待确认
      await this.sendAndWaitResponse({
        type: 'send_file',
        touser: externalUserId,
        open_kfid: openKfId,
        media_id: mediaId,
      });
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

      // 提取消息文本和媒体信息
      let text = '';
      let contentType: 'text' | 'image' | 'file' | 'voice' | 'video' = 'text';
      let imagePath: string | undefined;
      let filePath: string | undefined;
      let fileName: string | undefined;

      if (msg.msgtype === 'text') {
        text = msg.text?.content || '';
      } else if (msg.msgtype === 'image') {
        contentType = 'image';
        text = '[图片]';
      } else if (msg.msgtype === 'voice') {
        // 语音消息：直接回复客户请发送文字，不经过 AI
        const externalUserId = msg.external_userid || '';
        const openKfId = msg.open_kfid || '';
        const conversationId = `${externalUserId}||${openKfId}`;
        try {
          await this.outbound.sendMessage({
            conversationId,
            content: '暂不支持语音消息，请发送文字消息，谢谢 😊',
          });
        } catch (err) {
          console.error('[WecomKfConnector] ❌ 回复语音提示失败:', getErrorMessage(err));
        }
        return;
      } else if (msg.msgtype === 'video') {
        contentType = 'video';
        text = '[视频]';
      } else if (msg.msgtype === 'file') {
        contentType = 'file';
        text = '[文件]';
      } else if (msg.msgtype === 'miniprogram') {
        text = msg.miniprogram?.title || '[小程序]';
      } else if (msg.msgtype === 'link') {
        text = msg.link?.title || '[链接]';
      } else if (msg.msgtype === 'location') {
        text = `[位置: ${msg.location?.name || ''} ${msg.location?.address || ''}]`;
      } else {
        text = `[${msg.msgtype || '未知类型'}]`;
      }

      // 跳过空消息
      if (!text) return;

      // 下载媒体文件（如果有 media_url）
      if (msg.media_url && ['image', 'voice', 'video', 'file'].includes(msg.msgtype)) {
        try {
          const downloaded = await this.downloadMedia(msg.media_url, msg.msgtype, msgId);
          if (downloaded) {
            if (msg.msgtype === 'image') {
              imagePath = downloaded.path;
            } else {
              filePath = downloaded.path;
              fileName = downloaded.name;
            }
          }
        } catch (error) {
          console.warn('[WecomKfConnector] ⚠️ 下载媒体失败:', getErrorMessage(error));
        }
      }

      const nickname = msg.nickname || '未知用户';
      const kfName = msg.kf_name || msg.open_kfid || '未知客服';
      const externalUserId = msg.external_userid || '';
      const openKfId = msg.open_kfid || '';

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
          type: contentType,
          text,
          imagePath,
          filePath,
          fileName,
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
   * 下载媒体文件到本地临时目录
   */
  private async downloadMedia(mediaUrl: string, msgType: string, msgId: string): Promise<{ path: string; name: string } | null> {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // 根据消息类型推断扩展名
    const contentTypeHeader = response.headers.get('content-type') || '';
    let ext = '.bin';
    if (msgType === 'image') {
      ext = contentTypeHeader.includes('png') ? '.png' : '.jpg';
    } else if (msgType === 'voice') {
      ext = contentTypeHeader.includes('silk') ? '.silk' : '.amr';
    } else if (msgType === 'video') {
      ext = '.mp4';
    } else if (msgType === 'file') {
      // 尝试从 Content-Disposition 获取文件名
      const disposition = response.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^";\s]+)"?/);
      if (filenameMatch) {
        const originalName = filenameMatch[1];
        const dotIdx = originalName.lastIndexOf('.');
        if (dotIdx > 0) ext = originalName.substring(dotIdx);
      }
    }

    const savedName = `wecom-kf-${msgId.substring(0, 16)}${ext}`;
    const tempDir = this.getTempDir();
    const savedPath = path.join(tempDir, savedName);
    fs.writeFileSync(savedPath, buffer);

    console.log(`[WecomKfConnector] 📥 媒体文件已下载: ${savedPath} (${buffer.length} bytes)`);
    return { path: savedPath, name: savedName };
  }

  /**
   * 获取临时文件目录
   */
  private getTempDir(): string {
    const store = SystemConfigStore.getInstance();
    const settings = store.getWorkspaceSettings();
    const tempDir = path.join(settings.workspaceDir, '.deepbot', 'temp', 'uploads');
    ensureDirectoryExists(tempDir);
    return tempDir;
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

  /**
   * 发送 WebSocket 消息并等待服务端确认（message_sent 或 error）
   */
  private sendAndWaitResponse(payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const timeout = setTimeout(() => {
        this.ws?.removeListener('message', handler);
        // 超时不报错，视为成功（兼容旧版服务端不返回确认的情况）
        resolve();
      }, 15000);

      const handler = (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'message_sent') {
            clearTimeout(timeout);
            this.ws?.removeListener('message', handler);
            resolve();
          } else if (msg.type === 'send_error' || (msg.type === 'error' && msg.error)) {
            clearTimeout(timeout);
            this.ws?.removeListener('message', handler);
            reject(new Error(msg.error || '发送失败'));
          }
        } catch {
          // 非相关消息，忽略
        }
      };

      this.ws.on('message', handler);
      this.ws.send(JSON.stringify(payload));
    });
  }

  /**
   * 通过 WebSocket 获取 access_token
   */
  private getAccessToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const timeout = setTimeout(() => {
        this.ws?.removeListener('message', handler);
        reject(new Error('获取 access_token 超时'));
      }, 10000);

      const handler = (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'token') {
            clearTimeout(timeout);
            this.ws?.removeListener('message', handler);
            if (msg.access_token) {
              resolve(msg.access_token);
            } else {
              reject(new Error('access_token 为空'));
            }
          }
        } catch {
          // 非 token 消息，忽略
        }
      };

      this.ws.on('message', handler);
      this.ws.send(JSON.stringify({ type: 'get_token' }));
    });
  }

  /**
   * 上传临时素材到企微，获取 media_id
   * 
   * @param accessToken - 企微 access_token
   * @param filePath - 本地文件路径
   * @param mediaType - 素材类型：'image' | 'file' | 'voice'
   */
  private async uploadMedia(accessToken: string, filePath: string, mediaType: 'image' | 'file' | 'voice'): Promise<string> {
    const expandedPath = filePath.startsWith('~') 
      ? filePath.replace('~', process.env.HOME || '') 
      : filePath;
    
    if (!fs.existsSync(expandedPath)) {
      throw new Error(`文件不存在: ${expandedPath}`);
    }

    const fileBuffer = fs.readFileSync(expandedPath);
    const fileName = path.basename(expandedPath);

    // 构建 multipart/form-data
    const boundary = `----WebKitFormBoundary${Date.now().toString(36)}`;
    const contentType = mediaType === 'image' ? 'image/png' : 'application/octet-stream';

    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="media"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    // 调用企微上传临时素材 API
    const url = `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=${mediaType}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`上传素材失败: HTTP ${response.status}`);
    }

    const result = await response.json() as any;
    if (result.errcode && result.errcode !== 0) {
      throw new Error(`上传素材失败: ${result.errmsg} (errcode: ${result.errcode})`);
    }

    if (!result.media_id) {
      throw new Error('上传素材响应中缺少 media_id');
    }

    console.log(`[WecomKfConnector] ✅ 素材上传成功: ${mediaType}, media_id: ${result.media_id}`);
    return result.media_id;
  }
}
