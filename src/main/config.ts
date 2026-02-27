/**
 * 配置管理
 */

import { SystemConfigStore } from './database/system-config-store';

export interface DeepBotConfig {
  // API Key
  apiKey: string;
  
  // Base URL（OpenAI 兼容端点）
  baseUrl: string;
  
  // 模型 ID
  modelId: string;
  
  // 模型名称（用于显示）
  modelName: string;
  
  // 提供商名称（用于 pi-agent-core）
  providerName: string;
}

/**
 * 获取配置
 * 
 * 优先级：
 * 1. 数据库配置
 * 2. 环境变量
 * 3. 抛出错误（需要用户配置）
 */
export function getConfig(): DeepBotConfig {
  console.log('[Config] 🔍 开始读取模型配置...');
  
  // 尝试从数据库读取配置
  try {
    const store = SystemConfigStore.getInstance();
    const modelConfig = store.getModelConfig();
    
    console.log('[Config] 数据库配置:', {
      exists: !!modelConfig,
      hasApiKey: !!modelConfig?.apiKey,
      baseUrl: modelConfig?.baseUrl,
      modelId: modelConfig?.modelId,
    });
    
    if (modelConfig && modelConfig.apiKey && modelConfig.baseUrl && modelConfig.modelId) {
      console.log('[Config] ✅ 使用数据库配置');
      return {
        apiKey: modelConfig.apiKey,
        baseUrl: modelConfig.baseUrl,
        modelId: modelConfig.modelId,
        modelName: modelConfig.modelName,
        providerName: modelConfig.providerId,
      };
    } else {
      console.log('[Config] ⚠️ 数据库配置不完整');
    }
  } catch (error) {
    console.warn('[Config] ❌ 从数据库读取配置失败:', error);
  }
  
  // 从环境变量读取配置
  const apiKey = process.env.AI_API_KEY || process.env.QWEN_API_KEY || '';
  const baseUrl = process.env.AI_BASE_URL || '';
  const modelId = process.env.AI_MODEL_ID || '';
  const modelName = process.env.AI_MODEL_NAME || '';
  const providerName = process.env.AI_PROVIDER_NAME || '';
  
  console.log('[Config] 环境变量配置:', {
    hasApiKey: !!apiKey,
    hasBaseUrl: !!baseUrl,
    hasModelId: !!modelId,
  });
  
  // 如果没有配置，抛出错误
  if (!apiKey || !baseUrl || !modelId) {
    console.error('[Config] ❌ 模型未配置');
    throw new Error('模型未配置，请在系统设置中配置 AI 模型');
  }
  
  console.log('[Config] ✅ 使用环境变量配置');
  return {
    apiKey,
    baseUrl,
    modelId,
    modelName,
    providerName,
  };
}

/**
 * 检查配置是否存在
 */
export function hasConfig(): boolean {
  try {
    // 检查数据库配置
    const store = SystemConfigStore.getInstance();
    const modelConfig = store.getModelConfig();
    
    if (modelConfig && modelConfig.apiKey) {
      return true;
    }
  } catch (error) {
    console.warn('[Config] 检查数据库配置失败:', error);
  }
  
  // 检查环境变量
  const apiKey = process.env.AI_API_KEY || process.env.QWEN_API_KEY || '';
  const baseUrl = process.env.AI_BASE_URL || '';
  const modelId = process.env.AI_MODEL_ID || '';
  
  return !!(apiKey && baseUrl && modelId);
}

/**
 * 预设配置（仅用于参考，不包含 API Key）
 */
export const PRESET_CONFIGS = {
  // 通义千问 Plus（推荐）
  qwenPlus: {
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen-plus',
    modelName: '通义千问 Plus',
    providerName: 'dashscope',
  },
  
  // 通义千问 Max
  qwenMax: {
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen-max',
    modelName: '通义千问 Max',
    providerName: 'dashscope',
  },
  
  // Kimi (Moonshot AI)
  kimi: {
    apiKey: '',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelId: 'moonshot-v1-8k',
    modelName: 'Kimi',
    providerName: 'moonshot',
  },
};
