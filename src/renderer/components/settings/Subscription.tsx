/**
 * 订阅及付费页面
 * 
 * 显示获取 API Key 的方式（与 ApiKeyHelpModal 内容一致）
 */

import React from 'react';
import qrcodeImg from '../../assets/qrcode.png';
import { getLanguage } from '../../i18n';

export function Subscription() {
  const lang = getLanguage();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title" style={{ marginBottom: '16px' }}>
        {lang === 'zh' ? '订阅及付费' : 'Subscription'}
      </h3>

      <div style={{
        padding: '16px',
        background: 'var(--settings-input-bg)',
        borderRadius: '8px',
        fontSize: '13px',
        color: 'var(--settings-text-dim)',
        lineHeight: '1.6',
      }}>
        {/* 方式一：扫码获取 */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--settings-text)',
            marginBottom: '6px',
          }}>
            {lang === 'zh' ? '🔑 方式一：扫码获取 DeepBot Token' : '🔑 Option 1: Scan QR Code for DeepBot Token'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--settings-text-dim)', marginBottom: '12px' }}>
            {lang === 'zh'
              ? '选择 DeepBot 提供商时，扫码添加微信获取 Token'
              : 'When using DeepBot provider, scan the QR code to add WeChat and get a Token'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <img
              src={qrcodeImg}
              alt={lang === 'zh' ? '扫码添加微信' : 'Scan QR code to add WeChat'}
              style={{ width: '160px', height: '160px', borderRadius: '8px' }}
            />
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--settings-border)', margin: '16px 0' }} />

        {/* 方式二：自行申请 */}
        <div>
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--settings-text)',
            marginBottom: '6px',
          }}>
            {lang === 'zh' ? '🔑 方式二：自行申请（以 Qwen 为例）' : '🔑 Option 2: Apply Yourself (e.g. Qwen)'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--settings-text-dim)', lineHeight: '2' }}>
            {lang === 'zh' ? (
              <>
                1. 访问 <span style={{ color: 'var(--settings-accent)' }}>dashscope.console.aliyun.com</span><br/>
                2. 进入控制台 →「API-KEY 管理」<br/>
                3. 创建 API-KEY，复制密钥<br/>
                4. 粘贴到模型配置中保存即可
              </>
            ) : (
              <>
                1. Visit <span style={{ color: 'var(--settings-accent)' }}>dashscope.console.aliyun.com</span><br/>
                2. Go to Console → "API-KEY Management"<br/>
                3. Create an API-KEY and copy the key<br/>
                4. Paste it in Model Settings and save
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
