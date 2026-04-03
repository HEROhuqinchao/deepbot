/**
 * Slack 连接器测试脚本
 * 用于验证 Bot Token、App Token 和 Signing Secret 是否正确
 */

async function testSlackCredentials(botToken, appToken, signingSecret) {
  console.log('🔍 测试 Slack 凭证...\n');
  
  // 测试 1: 验证 Bot Token
  console.log('1️⃣ 测试 Bot Token...');
  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log('   ✅ Bot Token 有效');
      console.log('   团队:', data.team);
      console.log('   用户:', data.user);
    } else {
      console.error('   ❌ Bot Token 无效:', data.error);
      return false;
    }
  } catch (error) {
    console.error('   ❌ 请求失败:', error.message);
    return false;
  }
  
  // 测试 2: 验证 App Token (Socket Mode)
  console.log('\n2️⃣ 测试 App Token...');
  try {
    const response = await fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    if (data.ok) {
      console.log('   ✅ App Token 有效 (Socket Mode 已启用)');
      console.log('   WebSocket URL:', data.url?.substring(0, 50) + '...');
    } else {
      console.error('   ❌ App Token 无效:', data.error);
      console.log('   💡 提示: 需要在 Slack App 中启用 Socket Mode');
      return false;
    }
  } catch (error) {
    console.error('   ❌ 请求失败:', error.message);
    return false;
  }
  
  console.log('\n✅ 所有凭证验证通过！');
  return true;
}

// 使用方式：
// 1. 从 史丽慧小助理 配置页面复制凭证
// 2. 修改下面的值并运行此脚本

const BOT_TOKEN = 'xoxb-your-bot-token-here';
const APP_TOKEN = 'xapp-your-app-token-here';
const SIGNING_SECRET = 'your-signing-secret-here';

// 注意: Signing Secret 用于验证请求签名，需要配合 HTTP 回调使用
// Socket Mode 模式下不需要验证 Signing Secret

console.log('=====================================');
console.log('   Slack 连接器凭证测试工具');
console.log('=====================================\n');

testSlackCredentials(BOT_TOKEN, APP_TOKEN, SIGNING_SECRET);
