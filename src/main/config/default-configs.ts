/**
 * 默认配置常量
 * 
 * 统一管理系统的默认配置值，避免硬编码
 */

/**
 * 默认模型配置
 */
export const DEFAULT_MODEL_CONFIG = {
  providerType: 'qwen' as const,
  providerId: 'qwen',
  providerName: '通义千问',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  modelId: 'qwen-plus',
  modelName: 'Qwen Plus',
  apiKey: '',
};

/**
 * 默认图片生成工具配置
 */
export const DEFAULT_IMAGE_GENERATION_CONFIG = {
  model: 'gemini-3-pro-image-preview',
  apiUrl: 'https://www.im-director.com/api/gemini-proxy',
  apiKey: '',
};

/**
 * 默认 Web 搜索工具配置
 */
export const DEFAULT_WEB_SEARCH_CONFIG = {
  provider: 'qwen' as const,
  model: 'qwen-plus',
  apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
};
