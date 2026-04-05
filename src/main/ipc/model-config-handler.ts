/**
 * 模型配置 IPC 处理器
 */

import type {
  GetModelConfigResponse,
  SaveModelConfigRequest,
  SaveModelConfigResponse,
  TestModelConfigRequest,
  TestModelConfigResponse,
  FetchModelsRequest,
  FetchModelsResponse,
} from '../../types/ipc';
import type { Gateway } from '../gateway';
import { getErrorMessage } from '../../shared/utils/error-handler';
import { registerIpcHandler } from '../../shared/utils/ipc-utils';
import { SystemConfigStore } from '../database/system-config-store';

let configStore: SystemConfigStore | null = null;
let gatewayInstance: Gateway | null = null;

/**
 * 设置 Gateway 实例
 */
export function setGatewayForModelConfig(gateway: Gateway): void {
  gatewayInstance = gateway;
}

/**
 * 获取配置存储实例
 */
function getConfigStore(): SystemConfigStore {
  if (!configStore) {
    configStore = SystemConfigStore.getInstance();
  }
  return configStore;
}

interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

interface ChatCompletionResponse {
  choices?: unknown[];
}

interface ModelItem {
  id?: string;
}

interface ModelsResponse {
  data?: ModelItem[];
}

/**
 * 注册模型配置 IPC 处理器
 */
export function registerModelConfigHandlers(): void {
  // 获取模型配置
  registerIpcHandler<void, GetModelConfigResponse>(
    'model-config:get',
    async (): Promise<GetModelConfigResponse> => {
      try {
        const store = getConfigStore();
        const config = store.getModelConfig();

        return {
          success: true,
          config: config || undefined,
        };
      } catch (error) {
        console.error('[ModelConfigHandler] 获取模型配置失败:', error);
        return {
          success: false,
          error: getErrorMessage(error),
        };
      }
    }
  );

  // 保存模型配置
  registerIpcHandler<SaveModelConfigRequest, SaveModelConfigResponse>(
    'model-config:save',
    async (event, request): Promise<SaveModelConfigResponse> => {
      try {
        const store = getConfigStore();

        // 从模型映射表推断上下文窗口大小
        const { getContextWindowFromModelId } = await import('../utils/model-info-fetcher');
        const inferredContextWindow = getContextWindowFromModelId(request.config.modelId);

        // 如果用户没有手动设置，使用推断值
        const contextWindow = request.config.contextWindow || inferredContextWindow;

        console.log('[ModelConfigHandler] 上下文窗口:', {
          modelId: request.config.modelId,
          inferred: inferredContextWindow,
          userProvided: request.config.contextWindow,
          final: contextWindow,
        });

        // 保存配置
        const configToSave = {
          ...request.config,
          contextWindow,
          lastFetched: Date.now(),
        };

        store.saveModelConfig(configToSave);

        // 重新加载 Gateway 的模型配置
        if (gatewayInstance) {
          await gatewayInstance.reloadModelConfig();
        }

        // 通知前端配置已更新
        event.sender.send('model-config:updated', { success: true });

        return {
          success: true,
        };
      } catch (error) {
        console.error('[ModelConfigHandler] 保存模型配置失败:', error);
        return {
          success: false,
          error: getErrorMessage(error),
        };
      }
    }
  );

  // 测试模型配置
  registerIpcHandler<TestModelConfigRequest, TestModelConfigResponse>(
    'model-config:test',
    async (_event, request): Promise<TestModelConfigResponse> => {
      try {
        console.log('[ModelConfigHandler] 测试模型配置，收到参数:', {
          providerId: request.config.providerId,
          baseUrl: request.config.baseUrl,
          modelId: request.config.modelId,
          hasApiKey: !!request.config.apiKey,
          apiKeyLength: request.config.apiKey?.length,
        });

        if (!request.config.apiKey) {
          throw new Error('API Key 不能为空');
        }
        if (!request.config.baseUrl) {
          throw new Error('API 地址不能为空');
        }
        if (!request.config.modelId) {
          throw new Error('模型 ID 不能为空');
        }

        const apiType = request.config.apiType || 'openai-completions';
        const baseUrl = request.config.baseUrl.replace(/\/+$/, '');

        if (apiType === 'google-generative-ai') {
          const url = `${baseUrl}/models/${request.config.modelId}:generateContent?key=${request.config.apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Hello' }] }],
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as ApiErrorResponse;
            throw new Error(err.error?.message || `请求失败 (${res.status})`);
          }
        } else {
          const url = `${baseUrl}/chat/completions`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${request.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: request.config.modelId,
              messages: [{ role: 'user', content: 'Hello' }],
              max_tokens: 2,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as ApiErrorResponse;
            throw new Error(err.error?.message || `请求失败 (${res.status})`);
          }
          const data = await res.json() as ChatCompletionResponse;
          if (!data.choices || data.choices.length === 0) {
            throw new Error('API 返回空响应');
          }
        }

        console.log('[ModelConfigHandler] 测试连接成功');
        return { success: true };
      } catch (error) {
        console.error('[ModelConfigHandler] 测试模型配置失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '连接测试失败',
        };
      }
    }
  );

  // 获取远程模型列表（通过主进程代理，避免 CORS）
  registerIpcHandler<FetchModelsRequest, FetchModelsResponse>(
    'model-config:fetch-models',
    async (_event, request): Promise<FetchModelsResponse> => {
      try {
        if (!request.apiKey) {
          throw new Error('API Key 不能为空');
        }
        if (!request.baseUrl) {
          throw new Error('API 地址不能为空');
        }
        const modelsUrl = request.baseUrl.replace(/\/+$/, '') + '/models';
        const res = await fetch(modelsUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${request.apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`请求失败 (${res.status}): ${errText}`);
        }
        const data = await res.json() as ModelsResponse;
        const models = (data?.data || [])
          .filter((m: ModelItem): m is ModelItem & { id: string } => !!m?.id && typeof m.id === 'string')
          .sort((a, b) => a.id.localeCompare(b.id));
        return {
          success: true,
          models,
        };
      } catch (error) {
        console.error('[ModelConfigHandler] 获取模型列表失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取模型列表失败',
        };
      }
    }
  );

  console.info('[ModelConfigHandler] 模型配置 IPC 处理器已注册');
}
