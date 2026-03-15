/**
 * 连接器系统类型定义
 */

// ========== 连接器基础类型 ==========

/**
 * 连接器 ID
 */
export type ConnectorId = 'feishu' | 'dingtalk' | 'wechat' | 'slack';

/**
 * 连接器配置
 */
export interface ConnectorConfig {
  enabled: boolean;           // 是否启用
  [key: string]: any;         // 其他配置项
}

/**
 * 健康状态
 */
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  message: string;
}

// ========== Gateway 消息格式 ==========

/**
 * Gateway 消息（连接器发送给 Gateway 的消息）
 */
export interface GatewayMessage {
  // 消息元数据
  tabId: string;              // Tab ID（由 Gateway 分配）
  messageId: string;          // 消息 ID
  timestamp: number;          // 时间戳
  
  // 来源信息
  source: {
    type: 'ui' | 'connector' | 'scheduled_task';  // 消息来源
    connectorId?: ConnectorId;  // 连接器 ID
    conversationId?: string;    // 外部会话 ID
    senderId?: string;          // 发送者 ID
    senderName?: string;        // 发送者名称
  };
  
  // 消息内容
  content: {
    type: 'text' | 'image' | 'file';
    text?: string;            // 文本内容
    fileUrl?: string;         // 文件 URL
    fileName?: string;        // 文件名
  };
  
  // 原始数据（用于调试）
  raw?: any;
}

// ========== 连接器接口 ==========

/**
 * 连接器接口（简化版的 Channel Plugin）
 */
export interface Connector {
  // ========== 基本信息 ==========
  readonly id: ConnectorId;
  readonly name: string;
  readonly version: string;
  
  // ========== 配置管理 ==========
  config: {
    load(): Promise<ConnectorConfig | null>;
    save(config: ConnectorConfig): Promise<void>;
    validate(config: ConnectorConfig): boolean;
  };
  
  // ========== 生命周期 ==========
  initialize(config: ConnectorConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  
  // ========== 消息处理 ==========
  outbound: {
    sendMessage(params: {
      conversationId: string;
      content: string;
      replyTo?: string;
    }): Promise<void>;
    
    sendImage?(params: {
      conversationId: string;
      imagePath: string;
      caption?: string;
    }): Promise<void>;
    
    sendFile?(params: {
      conversationId: string;
      filePath: string;
      fileName?: string;
    }): Promise<void>;
  };
  
  // ========== 安全控制 ==========
  security: {
    verifySignature?(request: {
      headers: Record<string, string>;
      body: string;
    }): Promise<boolean>;
    
    dmPolicy: 'open' | 'pairing' | 'allowlist';
    groupPolicy: 'open' | 'allowlist' | 'disabled';
    requireMention: boolean;
  };
  
  // ========== Pairing 机制 ==========
  pairing?: {
    generatePairingCode(userId: string): string;
    verifyPairingCode(userId: string): boolean;
    approvePairing(code: string): Promise<void>;
  };
}

// ========== 飞书特定类型 ==========

/**
 * 飞书连接器配置
 */
export interface FeishuConnectorConfig extends ConnectorConfig {
  appId: string;              // 应用 ID（cli_xxx）
  appSecret: string;          // 应用密钥
  verificationToken: string;  // 验证 Token
  encryptKey?: string;        // 加密 Key（可选）
  botName: string;            // 机器人名称
  
  // 安全策略
  dmPolicy: 'open' | 'pairing' | 'allowlist';
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  requireMention: boolean;
  
  // 白名单（可选）
  allowFrom?: string[];       // 允许的用户 Open ID
  groupAllowFrom?: string[];  // 允许的群组 ID
}

/**
 * 飞书消息（内部格式）
 */
export interface FeishuIncomingMessage {
  messageId: string;
  timestamp: number;
  sender: {
    id: string;
    name: string;
    avatar?: string;
  };
  conversation: {
    id: string;
    type: 'private' | 'group';
    name?: string;
  };
  content: {
    type: 'text' | 'image' | 'file';
    text?: string;
    fileUrl?: string;
    fileName?: string;
  };
  raw: any;
}

/**
 * Pairing 记录
 */
export interface PairingRecord {
  connectorId: ConnectorId;
  userId: string;
  code: string;
  approved: boolean;
  createdAt: number;
  approvedAt?: number;
}
