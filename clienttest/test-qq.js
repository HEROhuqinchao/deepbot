/**
 * QQ 机器人连接器测试脚本
 * 用于验证 App ID 和 App Secret 是否正确
 */

async function testQQCredentials(appId, appSecret) {
  console.log('🔍 测试 QQ 机器人凭证...\n');
  
  // 获取 Access Token
  console.log('1️⃣ 获取 Access Token...');
  try {
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId: appId,
        clientSecret: appSecret,
      }),
    });
    
    const data = await response.json();
    
    if (data.access_token) {
      console.log('   ✅ Access Token 获取成功');
      console.log('   Token:', data.access_token.substring(0, 20) + '...');
      console.log('   类型:', data.token_type);
      console.log('   过期时间:', data.expires_in, '秒');
    } else {
      console.error('   ❌ 获取失败:', data.message || '未知错误');
      console.log('\n   常见错误:');
      console.log('   - 400: App ID 或 Secret 错误');
      console.log('   - 401: 未授权或应用未发布');
      return false;
    }
  } catch (error) {
    console.error('   ❌ 请求失败:', error.message);
    return false;
  }
  
  console.log('\n✅ 凭证验证通过！');
  console.log('\n💡 提示: QQ 机器人需要:');
  console.log('   1. 在 QQ 开放平台注册应用');
  console.log('   2. 获取 App ID 和 App Secret');
  console.log('   3. 配置 WebSocket 连接');
  console.log('   4. 发布并通过审核');
  
  return true;
}

// 使用方式：
// 1. 从 QQ 开放平台复制凭证
// 2. 修改下面的值并运行此脚本

const APP_ID = '1234567890';
const APP_SECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

console.log('=====================================');
console.log('   QQ 机器人连接器凭证测试工具');
console.log('=====================================\n');

testQQCredentials(APP_ID, APP_SECRET);
