/**
 * 飞书连接器测试脚本
 * 用于验证 App ID 和 App Secret 是否正确
 */

async function testFeishuCredentials(appId, appSecret) {
  console.log('🔍 测试飞书凭证...\n');
  
  // 获取 Tenant Access Token
  console.log('1️⃣ 获取 Tenant Access Token...');
  try {
    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
        }),
      }
    );
    
    const data = await response.json();
    
    if (data.code === 0 && data.tenant_access_token) {
      console.log('   ✅ Tenant Access Token 获取成功');
      console.log('   过期时间:', data.expire, '秒');
      
      // 测试获取机器人信息
      console.log('\n2️⃣ 获取机器人信息...');
      const botResponse = await fetch(
        'https://open.feishu.cn/open-apis/bot/v3/info',
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${data.tenant_access_token}`,
          },
        }
      );
      
      const botData = await botResponse.json();
      if (botData.code === 0) {
        console.log('   ✅ 机器人信息获取成功');
        console.log('   机器人名称:', botData.bot?.app_name);
        console.log('   机器人 Open ID:', botData.bot?.open_id?.substring(0, 20) + '...');
      } else {
        console.warn('   ⚠️ 获取机器人信息失败:', botData.msg);
      }
    } else {
      console.error('   ❌ 获取失败:', data.msg || `错误码: ${data.code}`);
      console.log('\n   常见错误:');
      console.log('   - 99991663: App ID 或 Secret 错误');
      console.log('   - 99991664: IP 不在白名单');
      console.log('   - 99991661: 应用未发布');
      return false;
    }
  } catch (error) {
    console.error('   ❌ 请求失败:', error.message);
    return false;
  }
  
  console.log('\n✅ 凭证验证通过！');
  return true;
}

// 使用方式：
// 1. 从飞书开放平台复制凭证
// 2. 修改下面的值并运行此脚本

const APP_ID = 'cli_xxxxxxxxxxxxxxxx';
const APP_SECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

console.log('=====================================');
console.log('   飞书连接器凭证测试工具');
console.log('=====================================\n');

testFeishuCredentials(APP_ID, APP_SECRET);
