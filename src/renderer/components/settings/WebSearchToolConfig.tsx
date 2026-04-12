/**
 * Web Search 工具配置页面
 */

import React, { useState, useEffect } from 'react';
import { 
  WEB_SEARCH_PROVIDER_PRESETS 
} from '../../../shared/config/default-configs';
import { api } from '../../api';
import { showToast } from '../../utils/toast';
import { ApiKeyHelpModal } from './ApiKeyHelpModal';

interface WebSearchToolConfig {
  provider: 'deepbot' | 'qwen' | 'gemini';
  model: string;
  apiUrl: string;
  apiKey: string;
}

interface WebSearchToolConfigProps {
  onClose?: () => void;
}

export function WebSearchToolConfig({ onClose }: WebSearchToolConfigProps) {
  const [config, setConfig] = useState<WebSearchToolConfig>({
    provider: 'deepbot',
    model: WEB_SEARCH_PROVIDER_PRESETS.deepbot.defaultModelId,
    apiUrl: WEB_SEARCH_PROVIDER_PRESETS.deepbot.baseUrl,
    apiKey: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false);
  const hasLoadedRef = React.useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const result = await api.getWebSearchToolConfig();
      if (result.success && result.config) {
        setConfig(result.config);
      }
    } catch (error) {
      console.error('加载 Web Search 工具配置失败:', error);
    }
  };

  const handleProviderChange = (newProvider: 'deepbot' | 'qwen' | 'gemini') => {
    const preset = WEB_SEARCH_PROVIDER_PRESETS[newProvider];
    setConfig({
      ...config,
      provider: newProvider,
      apiUrl: preset.baseUrl,
      model: preset.defaultModelId,
    });
  };

  const handleSave = async () => {
    if (!config.apiUrl) { showToast('error', '请输入 API 地址'); return; }
    if (!config.model) { showToast('error', '请输入模型 ID'); return; }
    if (!config.apiKey) { showToast('error', '请输入 API Key'); return; }

    setIsSaving(true);
    try {
      const result = await api.saveWebSearchToolConfig(config);
      if (result.success) {
        showToast('success', '✅ 保存成功！');
      } else {
        showToast('error', result.error || '保存失败');
      }
    } catch (error) {
      console.error('保存 Web Search 工具配置失败:', error);
      showToast('error', '保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-base font-medium text-gray-900 mb-2">Web Search 工具配置</h4>
        <p className="text-sm text-gray-600 mb-4">
          配置网络搜索能力，获取最新的网络信息、新闻、天气等实时数据。如需调用其他提供商，可通过安装 Skill 扩展。<span style={{ color: 'var(--settings-accent)' }}>推荐：Tavily Search Skill</span>
        </p>
      </div>

      {/* 提供商选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">提供商</label>
        <select
          value={config.provider}
          onChange={(e) => handleProviderChange(e.target.value as 'deepbot' | 'qwen' | 'gemini')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="deepbot">DeepBot（Gemini 3）</option>
          <option value="qwen">Qwen</option>
        </select>
      </div>

      {/* API 地址 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          API 地址 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={config.apiUrl}
          onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {config.provider === 'deepbot' && '无需魔法，直连 Gemini 3'}
          {config.provider === 'qwen' && '预设提供商的 API 地址（可修改）'}
          {config.provider === 'gemini' && '预设提供商的 API 地址（可修改）'}
        </p>
      </div>

      {/* 模型 ID */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          模型 ID <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={config.model}
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
          disabled={config.provider === 'deepbot'}
          placeholder={config.provider === 'qwen' ? 'qwen3.5-plus' : 'gemini-3-flash-preview'}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <p className="mt-1 text-xs text-gray-500">
          {config.provider === 'qwen' && '默认: qwen3.5-plus（可选: qwen-plus, qwen-turbo, qwen-max 等）'}
          {(config.provider === 'gemini' || config.provider === 'deepbot') && '默认: gemini-3-flash-preview'}
        </p>
      </div>

      {/* API Key */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-medium text-gray-700">API Key <span className="text-red-500">*</span></label>
          <span
            onClick={() => setShowApiKeyHelp(true)}
            style={{ fontSize: '11px', color: 'var(--settings-accent)', cursor: 'pointer' }}
          >
            如何获取？
          </span>
        </div>
        <input
          type="password"
          value={config.apiKey}
          onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          placeholder="sk-..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {config.provider === 'deepbot' && '点击「如何获取」获得 API Key，或使用自己的 Gemini API Key'}
          {config.provider === 'qwen' && 'Qwen API Key（可以与主模型使用相同的 Key）'}
          {config.provider === 'gemini' && 'Google Gemini API Key'}
        </p>
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end pt-4 border-t">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
        >
          {isSaving ? '保存中...' : '保存配置'}
        </button>
      </div>

      {/* 如何获取 API Key 模态框 */}
      {showApiKeyHelp && <ApiKeyHelpModal onClose={() => setShowApiKeyHelp(false)} />}
    </div>
  );
}
