/**
 * 钉钉 Stream 客户端
 * 
 * 实现钉钉开放平台 Stream 模式的 WebSocket 连接
 * 参考: https://open-dingtalk.github.io/developerpedia/docs/learn/stream/protocol
 */

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
 * 连接凭证响应
 */
interface ConnectionCredentials {
  endpoint: string;
  ticket: string;
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
  private connectionCredentials?: ConnectionCredentials;
  
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
      // 步骤1: 获取 access_token (用于发送消息)
      await this.fetchAccessToken();
      
      // 步骤2: 注册连接凭证 (获取 WebSocket endpoint 和 ticket)
      await this.registerConnection();
      
      // 步骤3: 建立 WebSocket 连接
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
    this.connectionCredentials = undefined;
    console.log('[DingTalkStream] 连接已停止');
  }
  
  /**
   * 获取 Access Token (用于发送消息)
   */
  private async fetchAccessToken(): Promise<void> {
    try {
      console.log('[DingTalkStream] 🔄 正在获取 AccessToken...');
      console.log('[DingTalkStream]   Client ID:', this.config.clientId.substring(0, 8) + '...');
      
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
      
      console.log('[DingTalkStream] 📥 AccessToken API 响应:', JSON.stringify(data, null, 2));
      
      // 钉钉 API 成功时返回 { accessToken, expireIn }
      // 失败时返回 { code, message }
      if (data.code !== undefined && data.code !== 0) {
        const errorMsg = data.message || `获取 AccessToken 失败 (code: ${data.code})`;
        console.error('[DingTalkStream] ❌ API 返回错误:', errorMsg);
        throw new Error(errorMsg);
      }
      
      if (!data.accessToken) {
        console.error('[DingTalkStream] ❌ API 响应中缺少 accessToken');
        throw new Error('API 响应格式错误: 缺少 accessToken');
      }
      
      this.accessToken = data.accessToken;
      console.log('[DingTalkStream] ✅ AccessToken 获取成功');
      console.log('[DingTalkStream]   过期时间:', data.expireIn, '秒');
    } catch (error) {
      console.error('[DingTalkStream] ❌ 获取 AccessToken 失败:', error);
      throw error;
    }
  }
  
  /**
   * 注册连接凭证 (获取 WebSocket endpoint 和 ticket)
   */
  private async registerConnection(): Promise<void> {
    try {
      console.log('[DingTalkStream] 🔄 正在注册 Stream 连接...');
      
      const response = await fetch('https://api.dingtalk.com/v1.0/gateway/connections/open', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          subscriptions: [
            {
              topic: '*',
              type: 'EVENT',
            },
            {
              topic: '/v1.0/im/bot/messages/get',
              type: 'CALLBACK',
            },
          ],
          ua: 'deepbot-dingtalk-connector/1.0.0',
        }),
      });
      
      const data = await response.json() as any;
      
      console.log('[DingTalkStream] 📥 连接注册 API 响应:', JSON.stringify(data, null, 2));
      
      if (data.code !== undefined && data.code !== 0) {
        const errorMsg = data.message || `注册连接失败 (code: ${data.code})`;
        console.error('[DingTalkStream] ❌ API 返回错误:', errorMsg);
        throw new Error(errorMsg);
      }
      
      if (!data.endpoint || !data.ticket) {
        console.error('[DingTalkStream] ❌ API 响应中缺少 endpoint 或 ticket');
        throw new Error('API 响应格式错误: 缺少 endpoint 或 ticket');
      }
      
      this.connectionCredentials = {
        endpoint: data.endpoint,
        ticket: data.ticket,
      };
      
      console.log('[DingTalkStream] ✅ 连接凭证获取成功');
      console.log('[DingTalkStream]   Endpoint:', data.endpoint);
      console.log('[DingTalkStream]   Ticket:', data.ticket.substring(0, 20) + '...');
    } catch (error) {
      console.error('[DingTalkStream] ❌ 注册连接失败:', error);
      throw error;
    }
  }
  
  /**
   * 建立 WebSocket 连接
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.connectionCredentials) {
          throw new Error('连接凭证未获取');
        }
        
        const { endpoint, ticket } = this.connectionCredentials;
        const url = `${endpoint}?ticket=${ticket}`;
        
        console.log('[DingTalkStream] 🔄 正在建立 WebSocket 连接...');
        console.log('[DingTalkStream]   URL:', endpoint + '?ticket=***');
        
        const ws = new WebSocket(url);
        this.ws = ws;
        
        ws.on('open', () => {
          console.log('[DingTalkStream] ✅ WebSocket 连接已打开');
          this.isConnected_ = true;
          this.startHeartbeat();
          resolve();
        });
        
        ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });
        
        ws.on('error', (error) => {
          console.error('[DingTalkStream] ❌ WebSocket 错误:', error);
          this.emit('error', error);
          reject(error);
        });
        
        ws.on('close', (code, reason) => {
          console.log('[DingTalkStream] WebSocket 连接已关闭', { code, reason: reason?.toString() });
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
      
      console.log('[DingTalkStream] 📨 收到消息:', JSON.stringify(message, null, 2));
      
      // 处理系统消息
      if (message.type === 'SYSTEM') {
        this.handleSystemMessage(message);
        return;
      }
      
      // 发送 ACK 确认
      this.sendAck(message);
      
      // 解析业务消息数据
      // 钉钉 Stream 协议：message.data 是 JSON 字符串
      let parsedData = message;
      if (message.data && typeof message.data === 'string') {
        try {
          parsedData = JSON.parse(message.data);
          // 保留原始消息的 headers 信息
          parsedData._headers = message.headers;
          parsedData._type = message.type;
        } catch (e) {
          console.warn('[DingTalkStream] 无法解析 message.data:', e);
        }
      }
      
      // 触发消息事件
      this.emit('message', parsedData);
      
    } catch (error) {
      console.error('[DingTalkStream] 解析消息失败:', error);
    }
  }
  
  /**
   * 处理系统消息
   */
  private handleSystemMessage(message: any): void {
    const topic = message.headers?.topic;
    
    if (topic === 'ping') {
      // 回复 pong
      this.sendPong();
    } else if (topic === 'disconnect') {
      console.log('[DingTalkStream] 收到断开连接通知');
      this.scheduleReconnect();
    }
  }
  
  /**
   * 发送 ACK 确认
   */
  private sendAck(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const ackMessage = {
        code: 200,
        message: 'OK',
        headers: {
          messageId: message.headers?.messageId,
          contentType: 'application/json',
        },
        data: JSON.stringify({}),
      };
      
      this.ws.send(JSON.stringify(ackMessage));
      console.log('[DingTalkStream] 📤 发送 ACK:', message.headers?.messageId);
    }
  }
  
  /**
   * 发送 Pong 响应
   */
  private sendPong(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const pongMessage = {
        code: 200,
        message: 'OK',
        headers: {
          contentType: 'application/json',
        },
        data: JSON.stringify({}),
      };
      
      this.ws.send(JSON.stringify(pongMessage));
      console.log('[DingTalkStream] 📤 发送 Pong');
    }
  }
  
  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    // 钉钉 Stream 协议使用服务器发送的 ping 消息
    // 客户端需要回复 pong，不需要主动发送心跳
    console.log('[DingTalkStream] 💓 心跳机制已启用 (被动模式)');
  }
  
  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.cleanup();
    
    this.reconnectTimer = setTimeout(() => {
      console.log('[DingTalkStream] 🔄 尝试重新连接...');
      this.start().catch((error) => {
        console.error('[DingTalkStream] ❌ 重连失败:', error);
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
    console.log('[DingTalkStream] 📤 发送单聊消息:', {
      userId: params.conversationId.substring(0, 30) + '...',
      contentLength: params.content.length,
      msgType: params.msgType,
    });
    
    const requestBody = {
      robotCode: this.config.clientId,
      userIds: [params.conversationId],
      msgKey: this.getMsgKey(params.msgType),
      msgParam: params.msgType === 'text' 
        ? JSON.stringify({ content: params.content })
        : params.content,
    };
    
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': this.accessToken!,
      },
      body: JSON.stringify(requestBody),
    });
    
    const result = await response.json() as any;
    console.log('[DingTalkStream] 📥 单聊消息响应:', JSON.stringify(result, null, 2));
    
    if (result.code !== undefined && result.code !== 0) {
      const errorMsg = `发送单聊消息失败: ${result.message || '未知错误'} (code: ${result.code})`;
      console.error('[DingTalkStream] ❌', errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log('[DingTalkStream] ✅ 单聊消息发送成功');
  }
  
  /**
   * 发送群聊消息
   */
  private async sendGroupMessage(params: {
    conversationId: string;
    content: string;
    msgType: string;
  }): Promise<void> {
    console.log('[DingTalkStream] 📤 发送群聊消息:', {
      conversationId: params.conversationId.substring(0, 20) + '...',
      contentLength: params.content.length,
      msgType: params.msgType,
      robotCode: this.config.clientId.substring(0, 10) + '...',
    });
    
    const requestBody = {
      robotCode: this.config.clientId,
      openConversationId: params.conversationId,
      msgKey: this.getMsgKey(params.msgType),
      msgParam: params.msgType === 'text' 
        ? JSON.stringify({ content: params.content })
        : params.content,
    };
    
    console.log('[DingTalkStream] 📤 请求体:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': this.accessToken!,
      },
      body: JSON.stringify(requestBody),
    });
    
    const result = await response.json() as any;
    console.log('[DingTalkStream] 📥 群聊消息响应:', JSON.stringify(result, null, 2));
    
    // 钉钉 API 成功时返回 { processQueryKeys: [...] }
    // 失败时返回 { code: xxx, message: "xxx" }
    if (result.code !== undefined && result.code !== 0) {
      const errorMsg = `发送群聊消息失败: ${result.message || '未知错误'} (code: ${result.code})`;
      console.error('[DingTalkStream] ❌', errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log('[DingTalkStream] ✅ 群聊消息发送成功');
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
