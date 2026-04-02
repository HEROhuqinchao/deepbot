/**
 * 连接器配置组件
 * 
 * 配置外部通讯工具（飞书、钉钉等）
 */

import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../api';
import { showToast } from '../../utils/toast';

interface ConnectorConfigProps {
  onClose: () => void;
}

interface Connector {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  hasConfig: boolean;
}

interface FeishuConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
  requirePairing?: boolean;
}

interface DingTalkConfig {
  clientId: string;
  clientSecret: string;
  robotCode?: string;
  enabled?: boolean;
  requirePairing?: boolean;
}

interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  enabled?: boolean;
  requirePairing?: boolean;
}

interface WeComConfig {
  corpId: string;
  agentId: string;
  secret: string;
  token?: string;
  encodingAESKey?: string;
  enabled?: boolean;
  requirePairing?: boolean;
}

interface QQConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
  requirePairing?: boolean;
}

type ConnectorConfig = FeishuConfig | DingTalkConfig | SlackConfig | WeComConfig | QQConfig;

interface PairingRecord {
  connectorId: string;
  userId: string;
  userName?: string;
  pairingCode: string;
  approved: boolean;
  isAdmin: boolean;
  createdAt: number;
  approvedAt?: number;
}

type TabType = 'config' | 'pairing' | 'guide';

export function ConnectorConfig({ onClose }: ConnectorConfigProps) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('config');
  
  // 飞书配置
  const [feishuConfig, setFeishuConfig] = useState<FeishuConfig>({
    appId: '',
    appSecret: '',
    enabled: false,
    requirePairing: false,
  });
  
  // 钉钉配置
  const [dingtalkConfig, setDingtalkConfig] = useState<DingTalkConfig>({
    clientId: '',
    clientSecret: '',
    robotCode: '',
    enabled: false,
    requirePairing: false,
  });
  
  // Slack 配置
  const [slackConfig, setSlackConfig] = useState<SlackConfig>({
    botToken: '',
    appToken: '',
    signingSecret: '',
    enabled: false,
    requirePairing: false,
  });
  
  // 企业微信配置
  const [wecomConfig, setWecomConfig] = useState<WeComConfig>({
    corpId: '',
    agentId: '',
    secret: '',
    token: '',
    encodingAESKey: '',
    enabled: false,
    requirePairing: false,
  });
  
  // QQ 配置
  const [qqConfig, setQQConfig] = useState<QQConfig>({
    appId: '',
    appSecret: '',
    enabled: false,
    requirePairing: false,
  });
  
  const [pairingRecords, setPairingRecords] = useState<PairingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loadingPairing, setLoadingPairing] = useState(false);
  // 连接器健康状态：connectorId -> 'healthy' | 'unhealthy' | 'checking'
  const [connectorHealthMap, setConnectorHealthMap] = useState<Record<string, 'healthy' | 'unhealthy' | 'checking'>>({});
  const hasLoadedRef = useRef(false);

  // 加载连接器列表
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    loadConnectors();
  }, []);

  const loadConnectors = async () => {
    try {
      setLoading(true);
      const result = await api.connectorGetAll();
      // 🔥 registerIpcHandler 会包装返回值为 { success: true, data: ... }
      const actualResult = result.data || result;

      if (actualResult.success && actualResult.connectors) {
        setConnectors(actualResult.connectors);

        // 默认选择飞书
        if (actualResult.connectors.length > 0) {
          const feishu = actualResult.connectors.find((c: any) => c.id === 'feishu');
          if (feishu) {
            setSelectedConnector('feishu');
            await loadConnectorConfig('feishu');
          }
        }

        // 健康检查：已有缓存状态则跳过，避免每次打开都重新检查
        for (const connector of actualResult.connectors) {
          if (connector.enabled) {
            // 已有缓存状态则不重复检查
            setConnectorHealthMap(prev => {
              if (prev[connector.id]) return prev;
              // 没有缓存，发起检查
              api.connectorHealthCheck(connector.id).then((healthResult: any) => {
                const actualHealth = healthResult.data || healthResult;
                const status = actualHealth.status === 'healthy' ? 'healthy' : 'unhealthy';
                setConnectorHealthMap(p => ({ ...p, [connector.id]: status }));
              }).catch(() => {
                setConnectorHealthMap(p => ({ ...p, [connector.id]: 'unhealthy' }));
              });
              return { ...prev, [connector.id]: 'checking' };
            });
          }
        }
      }
    } catch (error) {
      console.error('加载连接器列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadConnectorConfig = async (connectorId: string) => {
    try {
      const result = await api.connectorGetConfig(connectorId);
      // 🔥 registerIpcHandler 会包装返回值为 { success: true, data: ... }
      const actualResult = result.data || result;
      
      console.log('[ConnectorConfig] 加载配置结果:', actualResult);
      console.log('[ConnectorConfig] config 对象:', actualResult.config);
      
      if (actualResult.success && actualResult.config) {
        // 根据连接器类型设置对应的配置状态
        switch (connectorId) {
          case 'feishu':
            setFeishuConfig({
              appId: actualResult.config.appId || '',
              appSecret: actualResult.config.appSecret || '',
              enabled: actualResult.enabled || false,
              requirePairing: actualResult.config.requirePairing === true,
            });
            break;
          case 'dingtalk':
            setDingtalkConfig({
              clientId: actualResult.config.clientId || '',
              clientSecret: actualResult.config.clientSecret || '',
              robotCode: actualResult.config.robotCode || '',
              enabled: actualResult.enabled || false,
              requirePairing: actualResult.config.requirePairing === true,
            });
            break;
          case 'slack':
            setSlackConfig({
              botToken: actualResult.config.botToken || '',
              appToken: actualResult.config.appToken || '',
              signingSecret: actualResult.config.signingSecret || '',
              enabled: actualResult.enabled || false,
              requirePairing: actualResult.config.requirePairing === true,
            });
            break;
          case 'wecom':
            setWecomConfig({
              corpId: actualResult.config.corpId || '',
              agentId: actualResult.config.agentId || '',
              secret: actualResult.config.secret || '',
              token: actualResult.config.token || '',
              encodingAESKey: actualResult.config.encodingAESKey || '',
              enabled: actualResult.enabled || false,
              requirePairing: actualResult.config.requirePairing === true,
            });
            break;
          case 'qq':
            setQQConfig({
              appId: actualResult.config.appId || '',
              appSecret: actualResult.config.appSecret || '',
              enabled: actualResult.enabled || false,
              requirePairing: actualResult.config.requirePairing === true,
            });
            break;
        }
      } else {
        // 如果没有配置，设置默认值
        resetConfig(connectorId);
      }
      
      // pairing 记录始终加载（pairing 是固定功能）
      await loadPairingRecords(connectorId);
    } catch (error) {
      console.error('加载连接器配置失败:', error);
      resetConfig(connectorId);
    }
  };
  
  // 重置配置到默认值
  const resetConfig = (connectorId: string) => {
    switch (connectorId) {
      case 'feishu':
        setFeishuConfig({ appId: '', appSecret: '', enabled: false, requirePairing: false });
        break;
      case 'dingtalk':
        setDingtalkConfig({ clientId: '', clientSecret: '', robotCode: '', enabled: false, requirePairing: false });
        break;
      case 'slack':
        setSlackConfig({ botToken: '', appToken: '', signingSecret: '', enabled: false, requirePairing: false });
        break;
      case 'wecom':
        setWecomConfig({ corpId: '', agentId: '', secret: '', token: '', encodingAESKey: '', enabled: false, requirePairing: false });
        break;
      case 'qq':
        setQQConfig({ appId: '', appSecret: '', enabled: false, requirePairing: false });
        break;
    }
  };

  const loadPairingRecords = async (connectorId?: string) => {
    try {
      setLoadingPairing(true);
      const result = await api.connectorGetPairingRecords();
      // 🔥 registerIpcHandler 会包装返回值为 { success: true, data: ... }
      const actualResult = result.data || result;
      
      
      // records 可能是空数组，也要正常设置
      if (actualResult.success) {
        setPairingRecords(actualResult.records ?? []);
      } else {
        console.error('[Pairing] 获取失败:', actualResult.error);
        setPairingRecords([]);
      }
    } catch (error) {
      console.error('加载 Pairing 记录失败:', error);
      setPairingRecords([]);
    } finally {
      setLoadingPairing(false);
    }
  };

  const handleApprovePairing = async (pairingCode: string) => {
    try {
      const result = await api.connectorApprovePairing(pairingCode);
      // 🔥 registerIpcHandler 会包装返回值为 { success: true, data: ... }
      const actualResult = result.data || result;
      
      if (actualResult.success) {
        showToast('success', '配对已批准');
        await loadPairingRecords(selectedConnector || undefined);
      } else {
        showToast('error', actualResult.error || '批准失败');
      }
    } catch (error) {
      showToast('error', `批准失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleSetAdmin = async (connectorId: string, userId: string, isAdmin: boolean) => {
    try {
      const result = await api.connectorSetAdminPairing(connectorId, userId, isAdmin);
      const actualResult = result.data || result;
      if (actualResult.success) {
        showToast('success', isAdmin ? '已设为管理员' : '已取消管理员');
        await loadPairingRecords(selectedConnector || undefined);
      } else {
        showToast('error', actualResult.error || '操作失败');
      }
    } catch (error) {
      showToast('error', `操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleDeletePairing = async (connectorId: string, userId: string) => {
    if (!confirm('确定要删除此配对记录吗？')) {
      return;
    }
    
    try {
      const result = await api.connectorDeletePairing(connectorId, userId);
      // 🔥 registerIpcHandler 会包装返回值为 { success: true, data: ... }
      const actualResult = result.data || result;
      
      if (actualResult.success) {
        showToast('success', '配对记录已删除');
        await loadPairingRecords(selectedConnector || undefined);
      } else {
        showToast('error', actualResult.error || '删除失败');
      }
    } catch (error) {
      showToast('error', `删除失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleSave = async () => {
    if (!selectedConnector) return;

    // 根据平台类型验证必填字段
    let configToSave: any;
    switch (selectedConnector) {
      case 'feishu':
        if (!feishuConfig.appId.trim()) {
          showToast('error', '请输入 App ID');
          return;
        }
        if (!feishuConfig.appSecret.trim()) {
          showToast('error', '请输入 App Secret');
          return;
        }
        configToSave = { ...feishuConfig, enabled: false };
        break;
        
      case 'dingtalk':
        if (!dingtalkConfig.clientId.trim()) {
          showToast('error', '请输入 Client ID');
          return;
        }
        if (!dingtalkConfig.clientSecret.trim()) {
          showToast('error', '请输入 Client Secret');
          return;
        }
        configToSave = { ...dingtalkConfig, enabled: false };
        break;
        
      case 'slack':
        if (!slackConfig.botToken.trim()) {
          showToast('error', '请输入 Bot Token');
          return;
        }
        if (!slackConfig.appToken.trim()) {
          showToast('error', '请输入 App Token');
          return;
        }
        if (!slackConfig.signingSecret.trim()) {
          showToast('error', '请输入 Signing Secret');
          return;
        }
        configToSave = { ...slackConfig, enabled: false };
        break;
        
      case 'wecom':
        if (!wecomConfig.corpId.trim()) {
          showToast('error', '请输入企业 ID');
          return;
        }
        if (!wecomConfig.agentId.trim()) {
          showToast('error', '请输入应用 AgentId');
          return;
        }
        if (!wecomConfig.secret.trim()) {
          showToast('error', '请输入应用 Secret');
          return;
        }
        configToSave = { ...wecomConfig, enabled: false };
        break;
        
      case 'qq':
        if (!qqConfig.appId.trim()) {
          showToast('error', '请输入 App ID');
          return;
        }
        if (!qqConfig.appSecret.trim()) {
          showToast('error', '请输入 App Secret');
          return;
        }
        configToSave = { ...qqConfig, enabled: false };
        break;
        
      default:
        showToast('error', '未知的连接器类型');
        return;
    }

    setSaving(true);

    try {
      await api.connectorSaveConfig(selectedConnector, configToSave);
      showToast('success', '配置保存成功');
      await loadConnectors(); // 重新加载列表
    } catch (error) {
      showToast('error', `保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    if (!selectedConnector) return;

    const connector = connectors.find(c => c.id === selectedConnector);
    if (!connector?.hasConfig) {
      showToast('error', '请先保存配置');
      return;
    }

    setStarting(true);

    try {
      await api.connectorStart(selectedConnector);
      showToast('success', '连接器已启动');
      await loadConnectors(); // 重新加载列表
    } catch (error) {
      showToast('error', `启动失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!selectedConnector) return;

    setStarting(true);

    try {
      await api.connectorStop(selectedConnector);
      showToast('success', '连接器已停止');
      await loadConnectors(); // 重新加载列表
    } catch (error) {
      showToast('error', `停止失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setStarting(false);
    }
  };

  const selectedConnectorData = connectors.find(c => c.id === selectedConnector);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">外部通讯配置</h3>
        <p className="text-sm text-gray-500">
          配置飞书、钉钉等外部通讯工具，让 AI 助手可以在这些平台上响应消息
        </p>
      </div>

      {/* 连接器列表 */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-1">
          {loading ? (
            <div className="py-3 px-4 text-sm text-gray-400">加载中...</div>
          ) : connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={() => {
                setSelectedConnector(connector.id);
                loadConnectorConfig(connector.id);
              }}
              className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                selectedConnector === connector.id
                  ? 'border-blue-500 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {connector.name}
              {connector.enabled && (
                <>
                  {connectorHealthMap[connector.id] === 'checking' && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      检查中
                    </span>
                  )}
                  {connectorHealthMap[connector.id] === 'healthy' && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      运行中
                    </span>
                  )}
                  {connectorHealthMap[connector.id] === 'unhealthy' && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                      连接失败
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* 飞书配置 */}
      {selectedConnector === 'feishu' && (
        <div className="space-y-4">
          {/* 标签页切换 */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-1">
              <button
                onClick={() => setActiveTab('config')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'config'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                基础配置
              </button>
              <button
                onClick={() => {
                  setActiveTab('pairing');
                  loadPairingRecords(selectedConnector);
                }}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'pairing'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                Pairing 管理
                {pairingRecords.filter(r => !r.approved).length > 0 && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    {pairingRecords.filter(r => !r.approved).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'guide'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                配置说明
              </button>
            </nav>
          </div>

          {/* 基础配置标签页 */}
          {activeTab === 'config' && (
            <div className="space-y-4">

          {/* App ID */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              App ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={feishuConfig.appId}
              onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })}
              placeholder="cli_xxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* App Secret */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              App Secret <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={feishuConfig.appSecret}
              onChange={(e) => setFeishuConfig({ ...feishuConfig, appSecret: e.target.value })}
              placeholder="请输入 App Secret"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 是否需要配对授权 */}
          <div className="flex items-start space-x-3">
            <input
              type="checkbox"
              id="requirePairing"
              checked={feishuConfig.requirePairing === true}
              onChange={(e) => setFeishuConfig({ ...feishuConfig, requirePairing: e.target.checked })}
              className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <div>
              <label htmlFor="requirePairing" className="block text-sm font-medium text-gray-700 cursor-pointer">
                需要配对授权
              </label>
              <p className="text-xs text-gray-500 mt-0.5">
                {feishuConfig.requirePairing === true
                  ? '用户首次私聊需要管理员批准配对码后才能使用'
                  : '所有飞书用户可直接对话，无需配对授权（用户会自动加入配对列表）'}
              </p>
            </div>
          </div>

          {/* 群组使用说明 */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-sm text-blue-800">
              <strong>群组使用规则：</strong>在群组中必须 @ 机器人才会触发回复
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex space-x-3 pt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
            
            {selectedConnectorData?.enabled ? (
              <button
                onClick={handleStop}
                disabled={starting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {starting ? '停止中...' : '停止连接器'}
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={starting || !selectedConnectorData?.hasConfig}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {starting ? '启动中...' : '启动连接器'}
              </button>
            )}
          </div>
        </div>
      )}

          {/* Pairing 管理标签页 */}
          {activeTab === 'pairing' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">Pairing 说明</h4>
                <p className="text-sm text-blue-800">
                  当用户首次私聊机器人时，会收到一个配对码。管理员需要在此处批准配对码，用户才能正常使用机器人。
                </p>
              </div>

              {loadingPairing ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-gray-500">加载中...</div>
                </div>
              ) : pairingRecords.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  暂无配对记录
                </div>
              ) : (
                <div className="space-y-3">
                  {pairingRecords.map((record) => (
                    <div
                      key={`${record.connectorId}-${record.userId}`}
                      className="border border-gray-200 rounded-md p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">
                              {record.userName || `用户_${record.userId.slice(-8)}`}
                            </span>
                            <span className="text-xs text-gray-400 font-mono break-all">
                              {record.userId}
                            </span>
                            {record.approved ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 whitespace-nowrap">
                                已批准
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 whitespace-nowrap">
                                待批准
                              </span>
                            )}
                            {record.isAdmin && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 whitespace-nowrap">
                                管理员
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">
                            配对码: <span className="font-mono font-medium">{record.pairingCode}</span>
                          </div>
                          <div className="text-xs text-gray-400">
                            创建时间: {new Date(record.createdAt).toLocaleString('zh-CN')}
                            {record.approvedAt && (
                              <> · 批准时间: {new Date(record.approvedAt).toLocaleString('zh-CN')}</>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          {!record.approved && (
                            <button
                              onClick={() => handleApprovePairing(record.pairingCode)}
                              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors whitespace-nowrap"
                            >
                              批准
                            </button>
                          )}
                          <button
                            onClick={() => handleSetAdmin(record.connectorId, record.userId, !record.isAdmin)}
                            className={`px-3 py-1 text-sm rounded transition-colors whitespace-nowrap ${
                              record.isAdmin
                                ? 'bg-purple-600 text-white hover:bg-purple-700'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                          >
                            {record.isAdmin ? '管理员 ✓' : '设为管理员'}
                          </button>
                          <button
                            onClick={() => handleDeletePairing(record.connectorId, record.userId)}
                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors whitespace-nowrap"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* 配置说明标签页 */}
          {activeTab === 'guide' && (
            <div className="space-y-4 text-sm text-gray-700 pr-1">
              <h2 className="text-base font-semibold text-gray-900">飞书机器人配置指南</h2>
              <p>本文档介绍如何配置 DeepBot 的飞书连接器，使其能够通过飞书接收和发送消息。<span className="bg-yellow-200 text-yellow-900 px-1 rounded">大约 3 ～ 5 分钟配置完成。</span></p>

              <div>
                <h3 className="font-semibold text-gray-800 mb-1">前置条件</h3>
                <ol className="list-decimal list-inside space-y-1 text-gray-600">
                  <li>拥有飞书企业管理员权限</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold text-gray-800 mb-2">配置步骤</h3>

                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 pl-2 border-l-2 border-blue-400">1. 创建飞书企业自建应用</h4>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600 ml-2">
                      <li>访问 <a href="https://open.feishu.cn/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">飞书开放平台</a></li>
                      <li>登录后，点击「创建企业自建应用」</li>
                      <li>填写应用名称、描述等信息</li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 pl-2 border-l-2 border-blue-400">2. 获取应用凭证</h4>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600 ml-2">
                      <li>在应用详情页，进入「凭证与基础信息」</li>
                      <li>记录 <strong>App ID</strong> 和 <strong>App Secret</strong></li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 pl-2 border-l-2 border-blue-400">3. 配置应用权限</h4>
                    <p className="text-gray-600 mb-2">在「权限管理」页面添加以下权限，或点击「批量导入/导出权限」粘贴下方 JSON 一键导入：</p>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs text-gray-700 whitespace-pre overflow-x-auto">{`{
  "scopes": {
    "tenant": [
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "contact:user.basic_profile:readonly",
      "docs:document.comment:create",
      "docx:document",
      "docx:document.block:convert",
      "drive:drive",
      "drive:file",
      "im:chat",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:send_as_bot",
      "im:resource",
      "sheets:spreadsheet:readonly"
    ],
    "user": []
  }
}`}</div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 pl-2 border-l-2 border-blue-400">4. 在 DeepBot 中配置</h4>
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-2 text-yellow-800 text-xs">
                      注意：配置事件订阅前，需要先在 DeepBot 中填入 App ID 和 App Secret，否则无法建立长连接。
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600 ml-2">
                      <li>切换到「基础配置」标签页</li>
                      <li>填写 App ID 和 App Secret</li>
                      <li>点击「保存配置」，再点击「启动连接器」</li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 pl-2 border-l-2 border-blue-400">5. 配置事件订阅</h4>
                    <p className="text-gray-600 mb-1">进入应用的「事件与回调」页面：</p>
                    <div className="ml-2 space-y-2">
                      <div>
                        <p className="font-medium text-gray-700">事件配置：</p>
                        <ol className="list-decimal list-inside space-y-1 text-gray-600 ml-2">
                          <li>订阅方式选择「使用长连接接收事件」</li>
                          <li>添加事件 <code className="bg-gray-100 px-1 rounded">im.message.receive_v1</code></li>
                          <li>开通：接收群聊中@机器人消息、读取单聊消息、获取群组中所有消息</li>
                        </ol>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">回调配置：</p>
                        <ol className="list-decimal list-inside space-y-1 text-gray-600 ml-2">
                          <li>订阅方式同样选择「使用长连接接收事件」</li>
                        </ol>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 pl-2 border-l-2 border-blue-400">6. 发布应用</h4>
                    <p className="text-gray-600 ml-2">完成配置后，在飞书开放平台发布应用，审核通过后即可使用。</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-800 mb-2">使用说明</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium text-gray-800 mb-1">私聊（Pairing 模式）</h4>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600 ml-2">
                      <li>在飞书中搜索并添加机器人，发送任意消息</li>
                      <li>机器人返回配对码</li>
                      <li>管理员在「Pairing 管理」标签页批准配对码</li>
                      <li>批准后用户即可正常对话</li>
                    </ol>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-800 mb-1">群组使用</h4>
                    <p className="text-gray-600 ml-2">将机器人添加到群组，在群组中 @机器人 发送消息即可。</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 钉钉配置 */}
      {selectedConnector === 'dingtalk' && (
        <div className="space-y-4">
          {/* 标签页切换 */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-1">
              <button
                onClick={() => setActiveTab('config')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'config'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                基础配置
              </button>
              <button
                onClick={() => {
                  setActiveTab('pairing');
                  loadPairingRecords(selectedConnector);
                }}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'pairing'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                Pairing 管理
                {pairingRecords.filter(r => !r.approved).length > 0 && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    {pairingRecords.filter(r => !r.approved).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'guide'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                配置说明
              </button>
            </nav>
          </div>

          {/* 基础配置标签页 */}
          {activeTab === 'config' && (
            <div className="space-y-4">
              {/* Client ID */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Client ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={dingtalkConfig.clientId}
                  onChange={(e) => setDingtalkConfig({ ...dingtalkConfig, clientId: e.target.value })}
                  placeholder="应用的 ClientId"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Client Secret */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Client Secret <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={dingtalkConfig.clientSecret}
                  onChange={(e) => setDingtalkConfig({ ...dingtalkConfig, clientSecret: e.target.value })}
                  placeholder="请输入 Client Secret"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Robot Code（可选） */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  机器人码（可选）
                </label>
                <input
                  type="text"
                  value={dingtalkConfig.robotCode || ''}
                  onChange={(e) => setDingtalkConfig({ ...dingtalkConfig, robotCode: e.target.value })}
                  placeholder="自定义机器人码"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 是否需要配对授权 */}
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="dingtalk-requirePairing"
                  checked={dingtalkConfig.requirePairing === true}
                  onChange={(e) => setDingtalkConfig({ ...dingtalkConfig, requirePairing: e.target.checked })}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <label htmlFor="dingtalk-requirePairing" className="block text-sm font-medium text-gray-700 cursor-pointer">
                    需要配对授权
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {dingtalkConfig.requirePairing === true
                      ? '用户首次私聊需要管理员批准配对码后才能使用'
                      : '所有钉钉用户可直接对话，无需配对授权'}
                  </p>
                </div>
              </div>

              {/* 使用说明 */}
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">
                  <strong>群组使用规则：</strong>在群组中必须 @ 机器人才会触发回复
                </p>
              </div>

              {/* 操作按钮 */}
              <div className="flex space-x-3 pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中...' : '保存配置'}
                </button>
                
                {selectedConnectorData?.enabled ? (
                  <button
                    onClick={handleStop}
                    disabled={starting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '停止中...' : '停止连接器'}
                  </button>
                ) : (
                  <button
                    onClick={handleStart}
                    disabled={starting || !selectedConnectorData?.hasConfig}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '启动中...' : '启动连接器'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Pairing 管理标签页 */}
          {activeTab === 'pairing' && <PairingManagementTab
            loading={loadingPairing}
            records={pairingRecords}
            onApprove={handleApprovePairing}
            onSetAdmin={handleSetAdmin}
            onDelete={handleDeletePairing}
          />}

          {/* 配置说明标签页 */}
          {activeTab === 'guide' && (
            <div className="space-y-4 text-sm text-gray-700 pr-1">
              <h2 className="text-base font-semibold text-gray-900">钉钉机器人配置指南</h2>
              <p>本文档介绍如何配置 DeepBot 的钉钉连接器。<span className="bg-yellow-200 text-yellow-900 px-1 rounded">大约 3 ～ 5 分钟配置完成。</span></p>

              <div>
                <h3 className="font-semibold text-gray-800 mb-2">配置步骤</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">1. 创建钉钉企业内部应用</h4>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600 ml-2">
                      <li>访问 <a href="https://open.dingtalk.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">钉钉开放平台</a></li>
                      <li>进入「应用开发」→「企业内部开发」→「创建应用」</li>
                    </ol>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">2. 获取应用凭证</h4>
                    <p className="text-gray-600 ml-2">在应用详情页记录 <strong>ClientId</strong> 和 <strong>ClientSecret</strong></p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">3. 配置 Stream 模式</h4>
                    <p className="text-gray-600 ml-2">在「开发管理」→「消息推送」选择 Stream 模式，无需配置公网回调地址。</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">4. 发布应用</h4>
                    <p className="text-gray-600 ml-2">完成配置后发布应用，审核通过后即可使用。</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Slack 配置 */}
      {selectedConnector === 'slack' && (
        <div className="space-y-4">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-1">
              <button
                onClick={() => setActiveTab('config')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'config'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                基础配置
              </button>
              <button
                onClick={() => {
                  setActiveTab('pairing');
                  loadPairingRecords(selectedConnector);
                }}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'pairing'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                Pairing 管理
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'guide'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                配置说明
              </button>
            </nav>
          </div>

          {activeTab === 'config' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Bot Token <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={slackConfig.botToken}
                  onChange={(e) => setSlackConfig({ ...slackConfig, botToken: e.target.value })}
                  placeholder="xoxb-xxxxxxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500">Bot User OAuth Token，以 xoxb- 开头</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  App Token <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={slackConfig.appToken}
                  onChange={(e) => setSlackConfig({ ...slackConfig, appToken: e.target.value })}
                  placeholder="xapp-xxxxxxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500">App-Level Token，以 xapp- 开头，Socket Mode 必需</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Signing Secret <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={slackConfig.signingSecret}
                  onChange={(e) => setSlackConfig({ ...slackConfig, signingSecret: e.target.value })}
                  placeholder="请输入 Signing Secret"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="slack-requirePairing"
                  checked={slackConfig.requirePairing === true}
                  onChange={(e) => setSlackConfig({ ...slackConfig, requirePairing: e.target.checked })}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <label htmlFor="slack-requirePairing" className="block text-sm font-medium text-gray-700 cursor-pointer">
                    需要配对授权
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {slackConfig.requirePairing === true
                      ? '用户首次私聊需要管理员批准配对码后才能使用'
                      : '所有用户可直接对话，无需配对授权'}
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">
                  <strong>频道使用规则：</strong>在频道中必须 @机器人 才会触发回复
                </p>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中...' : '保存配置'}
                </button>
                
                {selectedConnectorData?.enabled ? (
                  <button
                    onClick={handleStop}
                    disabled={starting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '停止中...' : '停止连接器'}
                  </button>
                ) : (
                  <button
                    onClick={handleStart}
                    disabled={starting || !selectedConnectorData?.hasConfig}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '启动中...' : '启动连接器'}
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'pairing' && <PairingManagementTab
            loading={loadingPairing}
            records={pairingRecords}
            onApprove={handleApprovePairing}
            onSetAdmin={handleSetAdmin}
            onDelete={handleDeletePairing}
          />}

          {activeTab === 'guide' && (
            <div className="space-y-4 text-sm text-gray-700 pr-1">
              <h2 className="text-base font-semibold text-gray-900">Slack 机器人配置指南</h2>
              <p>本文档介绍如何配置 Slack 连接器。<span className="bg-yellow-200 text-yellow-900 px-1 rounded">大约 5 ～ 10 分钟配置完成。</span></p>

              <div>
                <h3 className="font-semibold text-gray-800 mb-2">配置步骤</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">1. 创建 Slack App</h4>
                    <p className="text-gray-600 ml-2">访问 <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Slack API</a> 创建新应用</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">2. 启用 Socket Mode</h4>
                    <p className="text-gray-600 ml-2">在「Socket Mode」页面启用并生成 App-Level Token</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">3. 配置 OAuth 权限</h4>
                    <p className="text-gray-600 ml-2">添加 app_mentions:read, chat:write, files:write 等权限后安装应用</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">4. 订阅事件</h4>
                    <p className="text-gray-600 ml-2">订阅 app_mention, message.im 等事件</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 企业微信配置 */}
      {selectedConnector === 'wecom' && (
        <div className="space-y-4">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-1">
              <button
                onClick={() => setActiveTab('config')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'config'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                基础配置
              </button>
              <button
                onClick={() => {
                  setActiveTab('pairing');
                  loadPairingRecords(selectedConnector);
                }}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'pairing'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                Pairing 管理
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'guide'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                配置说明
              </button>
            </nav>
          </div>

          {activeTab === 'config' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  企业 ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={wecomConfig.corpId}
                  onChange={(e) => setWecomConfig({ ...wecomConfig, corpId: e.target.value })}
                  placeholder="企业的 CorpId"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  应用 AgentId <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={wecomConfig.agentId}
                  onChange={(e) => setWecomConfig({ ...wecomConfig, agentId: e.target.value })}
                  placeholder="应用的 AgentId"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  应用 Secret <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={wecomConfig.secret}
                  onChange={(e) => setWecomConfig({ ...wecomConfig, secret: e.target.value })}
                  placeholder="请输入应用 Secret"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  回调 Token（可选）
                </label>
                <input
                  type="text"
                  value={wecomConfig.token || ''}
                  onChange={(e) => setWecomConfig({ ...wecomConfig, token: e.target.value })}
                  placeholder="HTTP 回调模式需要"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  加密密钥（可选）
                </label>
                <input
                  type="text"
                  value={wecomConfig.encodingAESKey || ''}
                  onChange={(e) => setWecomConfig({ ...wecomConfig, encodingAESKey: e.target.value })}
                  placeholder="HTTP 回调模式需要"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="wecom-requirePairing"
                  checked={wecomConfig.requirePairing === true}
                  onChange={(e) => setWecomConfig({ ...wecomConfig, requirePairing: e.target.checked })}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <label htmlFor="wecom-requirePairing" className="block text-sm font-medium text-gray-700 cursor-pointer">
                    需要配对授权
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {wecomConfig.requirePairing === true
                      ? '用户首次私聊需要管理员批准配对码后才能使用'
                      : '所有企业微信用户可直接对话，无需配对授权'}
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">
                  <strong>群组使用规则：</strong>在群组中必须 @机器人 才会触发回复
                </p>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中...' : '保存配置'}
                </button>
                
                {selectedConnectorData?.enabled ? (
                  <button
                    onClick={handleStop}
                    disabled={starting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '停止中...' : '停止连接器'}
                  </button>
                ) : (
                  <button
                    onClick={handleStart}
                    disabled={starting || !selectedConnectorData?.hasConfig}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '启动中...' : '启动连接器'}
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'pairing' && <PairingManagementTab
            loading={loadingPairing}
            records={pairingRecords}
            onApprove={handleApprovePairing}
            onSetAdmin={handleSetAdmin}
            onDelete={handleDeletePairing}
          />}

          {activeTab === 'guide' && (
            <div className="space-y-4 text-sm text-gray-700 pr-1">
              <h2 className="text-base font-semibold text-gray-900">企业微信机器人配置指南</h2>
              <p>本文档介绍如何配置企业微信连接器。<span className="bg-yellow-200 text-yellow-900 px-1 rounded">大约 5 ～ 10 分钟配置完成。</span></p>

              <div>
                <h3 className="font-semibold text-gray-800 mb-2">配置步骤</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">1. 创建企业微信应用</h4>
                    <p className="text-gray-600 ml-2">登录 <a href="https://work.weixin.qq.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">企业微信管理后台</a> 创建应用</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">2. 获取凭证</h4>
                    <p className="text-gray-600 ml-2">记录企业 ID、应用 AgentId 和 Secret</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">3. 开启机器人功能</h4>
                    <p className="text-gray-600 ml-2">在应用设置中开启机器人功能</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* QQ 机器人配置 */}
      {selectedConnector === 'qq' && (
        <div className="space-y-4">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-1">
              <button
                onClick={() => setActiveTab('config')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'config'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                基础配置
              </button>
              <button
                onClick={() => {
                  setActiveTab('pairing');
                  loadPairingRecords(selectedConnector);
                }}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'pairing'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                Pairing 管理
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`py-3 px-4 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'guide'
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                配置说明
              </button>
            </nav>
          </div>

          {activeTab === 'config' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  App ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={qqConfig.appId}
                  onChange={(e) => setQQConfig({ ...qqConfig, appId: e.target.value })}
                  placeholder="机器人 AppID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  App Secret <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={qqConfig.appSecret}
                  onChange={(e) => setQQConfig({ ...qqConfig, appSecret: e.target.value })}
                  placeholder="请输入 App Secret"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="qq-requirePairing"
                  checked={qqConfig.requirePairing === true}
                  onChange={(e) => setQQConfig({ ...qqConfig, requirePairing: e.target.checked })}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <label htmlFor="qq-requirePairing" className="block text-sm font-medium text-gray-700 cursor-pointer">
                    需要配对授权
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {qqConfig.requirePairing === true
                      ? '用户首次私聊需要管理员批准配对码后才能使用'
                      : '所有 QQ 用户可直接对话，无需配对授权'}
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-sm text-blue-800">
                  <strong>群组使用规则：</strong>在群组中必须 @机器人 才会触发回复
                </p>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中...' : '保存配置'}
                </button>
                
                {selectedConnectorData?.enabled ? (
                  <button
                    onClick={handleStop}
                    disabled={starting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '停止中...' : '停止连接器'}
                  </button>
                ) : (
                  <button
                    onClick={handleStart}
                    disabled={starting || !selectedConnectorData?.hasConfig}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {starting ? '启动中...' : '启动连接器'}
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'pairing' && <PairingManagementTab
            loading={loadingPairing}
            records={pairingRecords}
            onApprove={handleApprovePairing}
            onSetAdmin={handleSetAdmin}
            onDelete={handleDeletePairing}
          />}

          {activeTab === 'guide' && (
            <div className="space-y-4 text-sm text-gray-700 pr-1">
              <h2 className="text-base font-semibold text-gray-900">QQ 机器人配置指南</h2>
              <p>本文档介绍如何配置 QQ 机器人连接器。<span className="bg-yellow-200 text-yellow-900 px-1 rounded">大约 5 ～ 10 分钟配置完成。</span></p>

              <div>
                <h3 className="font-semibold text-gray-800 mb-2">配置步骤</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">1. 注册 QQ 开放平台</h4>
                    <p className="text-gray-600 ml-2">访问 <a href="https://bot.q.qq.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">QQ 开放平台</a> 注册开发者账号</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">2. 创建机器人</h4>
                    <p className="text-gray-600 ml-2">创建机器人并记录 AppID 和 AppSecret</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">3. 配置能力</h4>
                    <p className="text-gray-600 ml-2">选择支持的场景：单聊、群聊、频道</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">4. 发布机器人</h4>
                    <p className="text-gray-600 ml-2">提交审核，通过后即可使用</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Pairing 管理标签页组件（复用）
function PairingManagementTab({
  loading,
  records,
  onApprove,
  onSetAdmin,
  onDelete,
}: {
  loading: boolean;
  records: PairingRecord[];
  onApprove: (code: string) => void;
  onSetAdmin: (connectorId: string, userId: string, isAdmin: boolean) => void;
  onDelete: (connectorId: string, userId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-2">Pairing 说明</h4>
        <p className="text-sm text-blue-800">
          当用户首次私聊机器人时，会收到一个配对码。管理员需要在此处批准配对码，用户才能正常使用机器人。
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-500">加载中...</div>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          暂无配对记录
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <div
              key={`${record.connectorId}-${record.userId}`}
              className="border border-gray-200 rounded-md p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">
                      {record.userName || `用户_${record.userId.slice(-8)}`}
                    </span>
                    <span className="text-xs text-gray-400 font-mono break-all">
                      {record.userId}
                    </span>
                    {record.approved ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 whitespace-nowrap">
                        已批准
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 whitespace-nowrap">
                        待批准
                      </span>
                    )}
                    {record.isAdmin && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 whitespace-nowrap">
                        管理员
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    配对码: <span className="font-mono font-medium">{record.pairingCode}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    创建时间: {new Date(record.createdAt).toLocaleString('zh-CN')}
                    {record.approvedAt && (
                      <> · 批准时间: {new Date(record.approvedAt).toLocaleString('zh-CN')}</>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {!record.approved && (
                    <button
                      onClick={() => onApprove(record.pairingCode)}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors whitespace-nowrap"
                    >
                      批准
                    </button>
                  )}
                  <button
                    onClick={() => onSetAdmin(record.connectorId, record.userId, !record.isAdmin)}
                    className={`px-3 py-1 text-sm rounded transition-colors whitespace-nowrap ${
                      record.isAdmin
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {record.isAdmin ? '管理员 ✓' : '设为管理员'}
                  </button>
                  <button
                    onClick={() => onDelete(record.connectorId, record.userId)}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors whitespace-nowrap"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
