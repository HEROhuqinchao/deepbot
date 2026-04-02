/**
 * 钉钉 Stream 客户端
 * 
 * 实现钉钉开放平台 Stream 模式的 WebSocket 连接
 * 参考: https://open.dingtalk.com/document/development/introduction-to-stream-mode
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

/**
 * Stream 客户端配置
 */
interface StreamClientConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * 钉钉 Stream 客户端
 * 
 * 基于 WebSocket 实现与钉钉开放平台的长连接通信
 */
export class DingTalkStreamClient extends EventEmitter {
  private config: StreamClientConfig;
  private ws?: WebSocket;
  private isConnected_: boolean = false;
  private accessToken?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  
  // 钉钉 Stream 服务端点
  private static readonly STREAM_ENDPOINT = 'wss://stream.dingtalk.com/connect';
  
  constructor(config: StreamClientConfig) {
    super();
    this.config = config;
  }
  
  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.isConnected_;
  }
  
  /**
   * 启动 Stream 连接
   */
  async start(): Promise<void> {
    try {
      // 获取 access_token
      await this.fetchAccessToken();
      
      // 建立 WebSocket 连接
      await this.connect();
      
      console.log('[DingTalkStream] ✅ Stream 连接已建立');
    } catch (error) {
      console.error('[DingTalkStream] ❌ 启动失败:', error);
      throw error;
    }
  }
  
  /**
   * 停止连接
   */
  stop(): void {
    this.cleanup();
    this.isConnected_ = false;
    console.log('[DingTalkStream] 连接已停止');
  }
  
  /**
   * 获取 Access Token
   */
  private async fetchAccessToken(): Promise<void> {
    try {
      const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appKey: this.config.clientId,
          appSecret: this.config.clientSecret,
        }),
      });
      
      const data = await response.json() as any;
      
      if (data.code !== 0 || !data.accessToken) {
        throw new Error(data.message || '获取 AccessToken 失败');
      }
      
      this.accessToken = data.accessToken;
      console.log('[DingTalkStream] ✅ AccessToken 获取成功');
    } catch (error) {
      console.error('[DingTalkStream] ❌ 获取 AccessToken 失败:', error);
      throw error;
    }
  }
  
  /**
   * 建立 WebSocket 连接
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 构建连接 URL
        const timestamp = Date.now();
        const sign = this.generateSign(timestamp);
        const url = `${DingTalkStreamClient.STREAM_ENDPOINT}?clientId=${this.config.clientId}&timestamp=${timestamp}&sign=${sign}`;
        
        const ws = new WebSocket(url);
        this.ws = ws;
        
        ws.on('open', () => {
          console.log('[DingTalkStream] WebSocket 连接已打开');
          this.isConnected_ = true;
          this.startHeartbeat();
          resolve();
        });
        
        ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });
        
        ws.on('error', (error) => {
          console.error('[DingTalkStream] WebSocket 错误:', error);
          this.emit('error', error);
        });
        
        ws.on('close', () => {
          console.log('[DingTalkStream] WebSocket 连接已关闭');
          this.isConnected_ = false;
          this.scheduleReconnect();
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 生成签名
   */
  private generateSign(timestamp: number): string {
    const stringToSign = `${timestamp}\n${this.config.clientSecret}`;
    const hmac = crypto.createHmac('sha256', this.config.clientSecret);
    hmac.update(stringToSign);
    return hmac.digest('base64');
  }
  
  /**
   * 处理接收到的消息
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      // 处理心跳响应
      if (message.type === 'pong' || message.code === 'pong') {
        return;
      }
      
      // 处理业务消息
      console.log('[DingTalkStream] 📨 收到消息:', message);
      
      // 发送 ACK 确认
      this.sendAck(message.messageId || message.id);
      
      // 触发消息事件
      this.emit('message', message);
      
    } catch (error) {
      console.error('[DingTalkStream] 解析消息失败:', error);
    }
  }
  
  /**
   * 发送 ACK 确认
   */
  private sendAck(messageId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'ack',
        messageId,
      }));
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
    }, 30000); // 30秒心跳
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.cleanup();
    
    this.reconnectTimer = setTimeout(() => {
      console.log('[DingTalkStream] 尝试重新连接...');
      this.start().catch((error) => {
        console.error('[DingTalkStream] 重连失败:', error);
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
  
  /**
   * 发送消息
   */
  async sendMessage(params: {
    conversationId: string;
    content: string;
    msgType: string;
  }): Promise<void> {
    if (!this.accessToken) {
      await this.fetchAccessToken();
    }
    
    // 判断是单聊还是群聊
    const isGroup = params.conversationId.startsWith('cid');
    
    if (isGroup) {
      // 群聊消息
      await this.sendGroupMessage(params);
    } else {
      // 单聊消息
      await this.sendSingleMessage(params);
    }
  }
  
  /**
   * 发送单聊消息
   */
  private async sendSingleMessage(params: {
    conversationId: string;
    content: string;
    msgType: string;
  }): Promise<void> {
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': this.accessToken!,
      },
      body: JSON.stringify({
        robotCode: this.config.clientId,
        userIds: [params.conversationId],
        msgKey: this.getMsgKey(params.msgType),
        msgParam: params.msgType === 'text' 
          ? JSON.stringify({ content: params.content })
          : params.content,
      }),
    });
    
    const result = await response.json() as any;
    if (result.code && result.code !== 0) {
      throw new Error(result.message || '发送消息失败');
    }
  }
  
  /**
   * 发送群聊消息
   */
  private async sendGroupMessage(params: {
    conversationId: string;
    content: string;
    msgType: string;
  }): Promise<void> {
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': this.accessToken!,
      },
      body: JSON.stringify({
        robotCode: this.config.clientId,
        openConversationId: params.conversationId,
        msgKey: this.getMsgKey(params.msgType),
        msgParam: params.msgType === 'text' 
          ? JSON.stringify({ content: params.content })
          : params.content,
      }),
    });
    
    const result = await response.json() as any;
    if (result.code && result.code !== 0) {
      throw new Error(result.message || '发送消息失败');
    }
  }
  
  /**
   * 获取消息类型对应的 msgKey
   */
  private getMsgKey(msgType: string): string {
    const msgKeyMap: Record<string, string> = {
      text: 'sampleText',
      picture: 'sampleImageMsg',
      file: 'sampleFile',
      markdown: 'sampleMarkdown',
    };
    return msgKeyMap[msgType] || 'sampleText';
  }
  
  /**
   * 上传媒体文件
   */
  async uploadMedia(params: {
    type: 'image' | 'file';
    media: Buffer;
    fileName?: string;
  }): Promise<{ mediaId: string }> {
    if (!this.accessToken) {
      await this.fetchAccessToken();
    }
    
    // 使用 Node.js 方式上传媒体文件
    const formData = new FormData();
    const uint8Array = new Uint8Array(params.media);
    formData.append('type', params.type);
    formData.append('media', new Blob([uint8Array]), params.fileName || 'file');
    
    const response = await fetch(`https://api.dingtalk.com/v1.0/robot/mediaFiles/upload?robotCode=${this.config.clientId}`, {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': this.accessToken!,
      },
      body: formData,
    });
    
    const result = await response.json() as any;
    if (result.code && result.code !== 0) {
      throw new Error(result.message || '上传媒体失败');
    }
    
    return { mediaId: result.mediaId || result.data?.mediaId };
  }
}
