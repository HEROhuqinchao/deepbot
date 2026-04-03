/**
 * 钉钉连接器调试脚本
 * 用于验证 Client ID 和 Client Secret 是否正确
 */

async function testDingTalkCredentials(clientId, clientSecret) {
  console.log('🔍 测试钉钉凭证...');
  console.log('Client ID:', clientId);
  
  try {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appKey: clientId,
        appSecret: clientSecret,
      }),
    });
    
    const data = await response.json();
    console.log('API 响应:', JSON.stringify(data, null, 2));
    
    if (data.code === 0 && data.accessToken) {
      console.log('✅ 凭证验证成功！');
      console.log('Access Token:', data.accessToken.substring(0, 20) + '...');
      console.log('过期时间:', data.expireIn, '秒');
      return true;
    } else {
      console.error('❌ 凭证验证失败:', data.message || '未知错误');
      return false;
    }
  } catch (error) {
    console.error('❌ 请求失败:', error.message);
    return false;
  }
}

// 使用方式：
// 1. 从 史丽慧小助理 配置页面复制 Client ID 和 Client Secret
// 2. 修改下面的值并运行此脚本

const CLIENT_ID = 'ding48xxxxxxxxxxxxxx';
const CLIENT_SECRET = 'Fu7L2jCvwY_purCA6rT2UdRRexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

testDingTalkCredentials(CLIENT_ID, CLIENT_SECRET);
