import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PROVIDER_PRESETS } from '../../../shared/config/default-configs';
import { api } from '../../api';
import { showToast } from '../../utils/toast';
import { ApiKeyHelpModal } from './ApiKeyHelpModal';

interface ModelConfigItem {
  providerType: 'slhbot' | 'qwen' | 'deepseek' | 'gemini' | 'minimax' | 'custom';
  providerId: string;
  providerName: string;
  baseUrl: string;
  modelId: string;
  modelId2?: string;
  modelName: string;
  apiType: string;
  apiKey: string;
  contextWindow?: number;
  lastFetched?: number;
}

interface ModelInfo {
  id: string;
  label: string;
  category: 'main' | 'fast' | 'other';
}

interface ModelConfigProps {
  onClose: () => void;
}

// Qwen 模型显示名称映射
const QWEN_MODEL_LABELS: Record<string, string> = {
  'qwen-max': '通义千问-Max（最强能力）',
  'qwen-max-latest': '通义千问-Max（最新版）',
  'qwen-plus': '通义千问-Plus（平衡）',
  'qwen-plus-latest': '通义千问-Plus（最新版）',
  'qwen-turbo': '通义千问-Turbo（快速）',
  'qwen-turbo-latest': '通义千问-Turbo（最新版）',
  'qwen-coder-plus': '通义千问-代码-Plus',
  'qwen-coder-plus-latest': '通义千问-代码-Plus（最新版）',
  'qwen-math-plus': '通义千问-数学-Plus',
  'qwen-math-plus-latest': '通义千问-数学-Plus（最新版）',
  'qwen-vl-plus': '通义千问-视觉-Plus',
  'qwen-vl-plus-latest': '通义千问-视觉-Plus（最新版）',
  'qwen-vl-max': '通义千问-视觉-Max',
  'qwen-vl-max-latest': '通义千问-视觉-Max（最新版）',
  'qwen-audio-turbo': '通义千问-音频-Turbo',
  'qwen-long': '通义千问-Long（长文本）',
};

function getQwenModelLabel(id: string): string {
  return QWEN_MODEL_LABELS[id] || id;
}

function categorizeQwenModel(id: string): 'main' | 'fast' | 'other' {
  if (id.includes('max') && !id.includes('vl') && !id.includes('audio')) return 'main';
  if (id.includes('plus') && !id.includes('coder') && !id.includes('math') && !id.includes('vl')) return 'fast';
  if (id.includes('turbo') && !id.includes('vl') && !id.includes('audio')) return 'fast';
  return 'other';
}

export function ModelConfig({ onClose }: ModelConfigProps) {
  const [config, setConfig] = useState<ModelConfigItem>({
    providerType: 'qwen',
    providerId: 'qwen',
    providerName: '通义千问',
    baseUrl: PROVIDER_PRESETS.qwen.baseUrl,
    modelId: PROVIDER_PRESETS.qwen.defaultModelId,
    modelId2: PROVIDER_PRESETS.qwen.defaultModelId2,
    modelName: PROVIDER_PRESETS.qwen.defaultModelId,
    apiType: PROVIDER_PRESETS.qwen.apiType,
    apiKey: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const hasLoadedRef = useRef(false);
  const [isFirstTimeConfig, setIsFirstTimeConfig] = useState(false);
  const [isFromEnv, setIsFromEnv] = useState(false);
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Qwen 模型列表相关状态
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showMainModelDropdown, setShowMainModelDropdown] = useState(false);
  const [showFastModelDropdown, setShowFastModelDropdown] = useState(false);

  // 加载当前配置
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadConfig();
  }, []);

  // 当切换到 Qwen 且已有 API Key 时，自动获取模型列表
  useEffect(() => {
    if (config.providerType === 'qwen' && config.apiKey && availableModels.length === 0) {
      fetchQwenModels(config.apiKey, false);
    }
  }, [config.providerType, config.apiKey]);

  const loadConfig = async (skipFetchModels = false) => {
    try {
      const result = await api.getModelConfig();
      const actualResult = result.data || result;
      if (actualResult.success && actualResult.config) {
        const loadedConfig = {
          ...actualResult.config,
          providerType: actualResult.config.providerType || 'qwen',
          apiType: actualResult.config.apiType || 'openai-completions',
        };
        setConfig(loadedConfig);
        setIsFromEnv(!!actualResult.config.fromEnv);
        setIsFirstTimeConfig(!loadedConfig.apiKey);
        if (!skipFetchModels && loadedConfig.providerType === 'qwen' && loadedConfig.apiKey) {
          fetchQwenModels(loadedConfig.apiKey, false);
        }
      } else {
        setIsFirstTimeConfig(true);
      }
    } catch (error) {
      console.error('加载模型配置失败:', error);
      setIsFirstTimeConfig(true);
    }
  };

  const fetchQwenModels = async (apiKey?: string, showError = true) => {
    const key = apiKey || config.apiKey;
    if (!key) {
      if (showError) showToast('error', '请先输入 API Key');
      return;
    }
    setIsLoadingModels(true);
    try {
      const result = await api.fetchModels(config.baseUrl || PROVIDER_PRESETS.qwen.baseUrl, key);
      const actualResult = result.data || result;
      if (!actualResult.success) {
        throw new Error(actualResult.error || '获取模型列表失败');
      }
      const models: Array<{ id: string }> = (actualResult.models || [])
        .filter((m: any) => m?.id && typeof m.id === 'string')
        .sort((a: any, b: any) => a.id.localeCompare(b.id));

      const enriched = models.map((m) => ({
        id: m.id,
        label: getQwenModelLabel(m.id),
        category: categorizeQwenModel(m.id),
      }));

      setAvailableModels(enriched);
      showToast('success', `已获取 ${enriched.length} 个可用模型`);

      // 自动推荐主模型和快速模型（如果当前为空或不合法）
      const validIds = enriched.map((m) => m.id);
      const mainCandidates = enriched.filter((m) => m.category === 'main').map((m) => m.id);
      const fastCandidates = enriched.filter((m) => m.category === 'fast').map((m) => m.id);

      setConfig((prev) => {
        let next = { ...prev };
        const needMain = !prev.modelId || !validIds.includes(prev.modelId);
        const needFast = !prev.modelId2 || !validIds.includes(prev.modelId2);
        if (needMain && mainCandidates.length > 0) {
          next.modelId = mainCandidates[0];
          next.modelName = mainCandidates[0];
        } else if (needMain && fastCandidates.length > 0) {
          next.modelId = fastCandidates[0];
          next.modelName = fastCandidates[0];
        } else if (needMain && validIds.length > 0) {
          next.modelId = validIds[0];
          next.modelName = validIds[0];
        }
        if (needFast && fastCandidates.length > 0) {
          next.modelId2 = fastCandidates[0];
        } else if (needFast && mainCandidates.length > 1) {
          next.modelId2 = mainCandidates[1];
        } else if (needFast && validIds.length > 0) {
          next.modelId2 = validIds[0];
        }
        return next;
      });
    } catch (error) {
      console.error('获取 Qwen 模型列表失败:', error);
      if (showError) {
        showToast('error', `获取模型列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleProviderTypeChange = (providerType: 'slhbot' | 'qwen' | 'deepseek' | 'gemini' | 'minimax' | 'custom') => {
    const preset = PROVIDER_PRESETS[providerType];
    setConfig({
      ...config,
      providerType,
      providerId: providerType,
      providerName: preset.name,
      baseUrl: preset.baseUrl,
      modelId: preset.defaultModelId,
      modelId2: preset.defaultModelId2 || undefined,
      modelName: preset.defaultModelId,
      apiType: preset.apiType,
      contextWindow: undefined,
    });
    setAvailableModels([]);
  };

  const handleTest = async () => {
    if (!config.baseUrl) {
      showToast('error', '请输入 API 地址');
      return;
    }
    if (!config.modelId) {
      showToast('error', '请输入模型 ID');
      return;
    }
    if (!config.apiKey) {
      showToast('error', '请输入 API Key');
      return;
    }
    setIsTesting(true);
    try {
      const result = await api.testModelConfig(config);
      const actualResult = result.data || result;
      if (actualResult.success) {
        showToast('success', '✅ 模型连接测试成功！当前模型可用');
      } else {
        showToast('error', actualResult.error || '连接测试失败');
      }
    } catch (error) {
      console.error('模型连接测试失败:', error);
      showToast('error', `连接测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!config.baseUrl) {
      showToast('error', '请输入 API 地址');
      return;
    }
    if (!config.modelId) {
      showToast('error', '请输入模型 ID');
      return;
    }
    if (!config.apiKey) {
      showToast('error', '请输入 API Key');
      return;
    }
    setIsSaving(true);
    try {
      const result = await api.saveModelConfig(config);
      const actualResult = result.data || result;
      if (actualResult.success) {
        showToast('success', '保存成功！配置已生效');
        await loadConfig(true);
        if (isFirstTimeConfig) {
          setTimeout(() => onClose(), 1000);
        }
      } else {
        showToast('error', actualResult.error || '保存失败');
      }
    } catch (error) {
      showToast('error', '保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const mainModels = useMemo(() => availableModels.filter((m) => m.category === 'main' || m.category === 'fast'), [availableModels]);
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const m of availableModels) {
      const cat = m.category === 'main' ? '主模型' : m.category === 'fast' ? '快速模型' : '其他模型';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    }
    return groups;
  }, [availableModels]);

  const ModelSelect = React.memo(function ModelSelect({
    value,
    onSelect,
    open,
    setOpen,
    placeholder,
  }: {
    value: string;
    onSelect: (id: string) => void;
    open: boolean;
    setOpen: (v: boolean) => void;
    placeholder?: string;
  }) {
    const [search, setSearch] = useState('');
    const inputRef = useRef<HTMLInputElement | null>(null);

    const filteredGroups = useMemo(() => {
      const s = search.trim().toLowerCase();
      if (!s) return groupedModels;
      const next: Record<string, ModelInfo[]> = {};
      for (const [cat, items] of Object.entries(groupedModels)) {
        const filtered = items.filter(
          (m) => m.id.toLowerCase().includes(s) || m.label.toLowerCase().includes(s)
        );
        if (filtered.length) next[cat] = filtered;
      }
      return next;
    }, [search, groupedModels]);

    useEffect(() => {
      if (open) {
        setSearch('');
        setTimeout(() => inputRef.current?.focus(), 10);
      }
    }, [open]);

    return (
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onSelect(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder={placeholder || '请选择或输入模型'}
          className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span
          onClick={() => setOpen(!open)}
          style={{
            position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
            cursor: 'pointer', color: 'var(--settings-text-dim, #999)', fontSize: '10px',
            pointerEvents: 'auto',
          }}
        >▼</span>
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            background: 'var(--settings-bg, #fff)', border: '1px solid var(--settings-border, #d1d5db)',
            borderTop: 'none', borderRadius: '0 0 6px 6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid #eee' }}>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模型..."
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '100%', padding: '4px 8px', fontSize: '12px',
                  border: '1px solid #ddd', borderRadius: '4px', outline: 'none',
                }}
              />
            </div>
            <ul style={{
              maxHeight: '200px', overflowY: 'auto',
              listStyle: 'none', margin: 0, padding: '4px 0',
            }}>
              {Object.entries(filteredGroups).map(([category, items]) => (
                <React.Fragment key={category}>
                  <li style={{
                    padding: '4px 12px', fontSize: '11px', color: '#999',
                    fontWeight: 600, background: 'rgba(0,0,0,0.03)',
                  }}>
                    {category}
                  </li>
                  {items.map((m) => (
                    <li key={m.id}
                      onMouseDown={() => { onSelect(m.id); setOpen(false); }}
                      style={{
                        padding: '6px 12px', cursor: 'pointer', fontSize: '13px',
                        color: value === m.id ? 'var(--settings-accent, #3b82f6)' : 'var(--settings-text, #333)',
                        fontWeight: value === m.id ? 600 : 400,
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--settings-bg-light, rgba(59,130,246,0.08))'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {m.label}
                    </li>
                  ))}
                </React.Fragment>
              ))}
              {availableModels.length === 0 && (
                <li style={{ padding: '8px 12px', fontSize: '12px', color: '#999' }}>暂无可用模型，请点击"获取模型列表"</li>
              )}
              {availableModels.length > 0 && Object.keys(filteredGroups).length === 0 && (
                <li style={{ padding: '8px 12px', fontSize: '12px', color: '#999' }}>未找到匹配模型</li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  });

  const renderModelDropdown = (
    value: string,
    onSelect: (id: string) => void,
    open: boolean,
    setOpen: (v: boolean) => void,
    placeholder?: string
  ) => (
    <ModelSelect
      value={value}
      onSelect={onSelect}
      open={open}
      setOpen={setOpen}
      placeholder={placeholder}
    />
  );

  return (
    <div className="space-y-6">
      {isFromEnv && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">当前使用环境变量配置</h3>
              <div className="mt-1 text-sm text-blue-700">
                <p>模型配置来自 <code className="bg-blue-100 px-1 rounded">.env</code> 文件。修改并保存后将优先使用此处的配置。</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!config.apiKey && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">模型未配置</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>请配置 API 地址和密钥后才能使用 史丽慧小助理。</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">模型配置</h3>
        <p className="text-sm text-gray-500">选择 AI 模型提供商并配置 API 密钥</p>
      </div>

      {/* 提供商选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">提供商</label>
        <select
          value={config.providerType}
          onChange={(e) => handleProviderTypeChange(e.target.value as any)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="slhbot">史丽慧小助理（推荐）</option>
          <option value="qwen">Qwen</option>
          <option value="deepseek">DeepSeek</option>
          <option value="gemini">Google Gemini</option>
          <option value="minimax">MiniMax</option>
          <option value="custom">自定义（OpenAI、Claude）</option>
        </select>
        <p className="mt-1 text-xs text-gray-500">选择预设提供商或自定义配置</p>
      </div>

      {/* API 类型（仅自定义模式显示） */}
      {config.providerType === 'custom' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">API 类型</label>
          <select
            value={config.apiType}
            onChange={(e) => setConfig({ ...config, apiType: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="openai-completions">OpenAI 兼容（OpenAI、OpenRouter、Claude、Qwen、DeepSeek 等）</option>
            <option value="google-generative-ai">Google Generative AI（Gemini 原生格式）</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">大多数提供商使用 OpenAI 兼容格式，Google Gemini 原生 API 选第二项</p>
        </div>
      )}

      {/* API 地址 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">API 地址 <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={config.baseUrl}
          onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {config.providerType === 'custom'
            ? '输入兼容 OpenAI API 或 Google Generative AI 格式的地址'
            : '预设提供商的 API 地址（可修改）'}
        </p>
      </div>

      {/* 模型 ID（主模型） */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">模型 ID（主模型） <span className="text-red-500">*</span></label>
        {config.providerType === 'slhbot' ? (
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={config.modelId}
              onChange={(e) => setConfig({ ...config, modelId: e.target.value, modelName: e.target.value, contextWindow: undefined })}
              onFocus={() => setShowModelDropdown(true)}
              onBlur={() => setTimeout(() => setShowModelDropdown(false), 150)}
              placeholder="minimax-m2.5"
              className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                cursor: 'pointer', color: 'var(--settings-text-dim, #999)', fontSize: '10px',
                pointerEvents: 'auto',
              }}
            >▼</span>
            {showModelDropdown && (
              <ul style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                background: 'var(--settings-bg, #fff)', border: '1px solid var(--settings-border, #d1d5db)',
                borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto',
                listStyle: 'none', margin: 0, padding: '4px 0',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}>
                {['deepseek-v3.2', 'minimax-m2.5', 'minimax-m2.7', 'glm-4.7', 'kimi-k2.5', 'step-3.5-flash', 'qwen3.5-plus-02-15'].map(id => (
                  <li key={id}
                    onMouseDown={() => setConfig({ ...config, modelId: id, modelName: id, contextWindow: undefined })}
                    style={{
                      padding: '6px 12px', cursor: 'pointer', fontSize: '13px',
                      color: config.modelId === id ? 'var(--settings-accent, #3b82f6)' : 'var(--settings-text, #333)',
                      fontWeight: config.modelId === id ? 600 : 400,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--settings-bg-light, rgba(59,130,246,0.08))'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >{id}</li>
                ))}
              </ul>
            )}
          </div>
        ) : config.providerType === 'qwen' ? (
          <div className="space-y-2">
            {renderModelDropdown(
              config.modelId,
              (id) => setConfig({ ...config, modelId: id, modelName: id, contextWindow: undefined }),
              showMainModelDropdown,
              setShowMainModelDropdown,
              '请选择主模型'
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchQwenModels(undefined, true)}
                disabled={isLoadingModels || !config.apiKey}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingModels ? '获取中...' : '获取模型列表'}
              </button>
              <span className="text-xs text-gray-500">
                {availableModels.length > 0 ? `已获取 ${availableModels.length} 个模型` : '输入 API Key 后点击获取可用模型'}
              </span>
            </div>
          </div>
        ) : (
          <input
            type="text"
            value={config.modelId}
            onChange={(e) => setConfig({ ...config, modelId: e.target.value, modelName: e.target.value, contextWindow: undefined })}
            placeholder={
              config.providerType === 'deepseek'
                ? 'deepseek-chat'
                : config.providerType === 'gemini'
                  ? 'gemini-3-pro-preview'
                  : config.providerType === 'minimax'
                    ? 'MiniMax-M2.5'
                    : 'model-id'
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        <p className="mt-1 text-xs text-gray-500">
          {config.providerType === 'slhbot' && '从列表选择或输入自定义模型 ID'}
          {config.providerType === 'qwen' && '推荐选择 qwen-max（高质量）或 qwen-plus（平衡）'}
          {config.providerType === 'deepseek' && '推荐: deepseek-chat'}
          {config.providerType === 'gemini' && '推荐: gemini-3-pro-preview（高质量）或 gemini-3-flash-preview（快速）'}
          {config.providerType === 'minimax' && '推荐: MiniMax-M2.5（高质量）或 MiniMax-M2.5-highspeed（快速）'}
          {config.providerType === 'custom' && '输入主模型 ID'}
        </p>
      </div>

      {/* 模型 ID 2（快速模型） */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">模型 ID 2（快速模型，可选）</label>
        {config.providerType === 'qwen' && availableModels.length > 0 ? (
          renderModelDropdown(
            config.modelId2 || '',
            (id) => setConfig({ ...config, modelId2: id || undefined }),
            showFastModelDropdown,
            setShowFastModelDropdown,
            '请选择快速模型'
          )
        ) : (
          <input
            type="text"
            value={config.modelId2 || ''}
            onChange={(e) => setConfig({ ...config, modelId2: e.target.value || undefined })}
            placeholder={
              config.providerType === 'qwen'
                ? 'qwen-plus'
                : config.providerType === 'deepseek'
                  ? 'deepseek-chat'
                  : config.providerType === 'gemini'
                    ? 'gemini-3-flash-preview'
                    : config.providerType === 'minimax'
                      ? 'MiniMax-M2.5-highspeed'
                      : 'fast-model-id'
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        <p className="mt-1 text-xs text-gray-500">
          {config.providerType === 'qwen' && '推荐: qwen-plus（用于轻量级任务，如语义判断）'}
          {config.providerType === 'deepseek' && '推荐: deepseek-chat（与主模型相同）'}
          {config.providerType === 'gemini' && '推荐: gemini-3-flash-preview（用于轻量级任务）'}
          {config.providerType === 'minimax' && '推荐: MiniMax-M2.5-highspeed（用于轻量级任务）'}
          {config.providerType === 'custom' && '输入快速模型 ID（用于轻量级任务）'}
        </p>
      </div>

      {/* API Key */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-medium text-gray-700">API Key <span className="text-red-500">*</span></label>
          <span
            onClick={() => setShowApiKeyHelp(true)}
            style={{ fontSize: '11px', color: 'var(--settings-accent)', cursor: 'pointer' }}
          >如何获取？</span>
        </div>
        <input
          type="password"
          value={config.apiKey}
          onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          placeholder={config.providerType === 'gemini' ? 'AIza...' : 'sk-...'}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {config.providerType === 'gemini'
            ? 'Google AI Studio API Key（以 AIza 开头）将加密存储在本地'
            : 'API 密钥将加密存储在本地'}
        </p>
      </div>

      {/* 上下文窗口大小（可编辑） */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">上下文窗口</label>
        <input
          type="number"
          value={config.contextWindow || ''}
          onChange={(e) => setConfig({ ...config, contextWindow: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder="自动推断"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">留空则根据模型 ID 自动推断（推荐）。如需精确值，请手动输入</p>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end pt-4 border-t gap-3">
        <button
          onClick={handleTest}
          disabled={isTesting || isSaving}
          className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTesting ? '测试中...' : '测试连接'}
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? '保存并测试...' : '保存配置'}
        </button>
      </div>

      {/* 如何获取 API Key 模态框 */}
      {showApiKeyHelp && <ApiKeyHelpModal onClose={() => setShowApiKeyHelp(false)} />}
    </div>
  );
}
