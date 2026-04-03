/**
 * 企业微信连接器测试脚本
 * 用于验证 CorpId、AgentId 和 Secret 是否正确
 */

async function testWeComCredentials(corpId, agentId, secret) {
  console.log('🔍 测试企业微信凭证...\n');
  
  // 获取 Access Token
  console.log('1️⃣ 获取 Access Token...');
  let accessToken;
  try {
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`,
      { method: 'GET' }
    );
    
    const data = await response.json();
    
    if (data.errcode === 0 && data.access_token) {
      accessToken = data.access_token;
      console.log('   ✅ Access Token 获取成功');
      console.log('   过期时间:', data.expires_in, '秒');
    } else {
      console.error('   ❌ 获取失败:', data.errmsg || `错误码: ${data.errcode}`);
      console.log('\n   常见错误:');
      console.log('   - 40001: CorpID 或 Secret 错误');
      console.log('   - 40013: CorpID 格式错误');
      console.log('   - 40014: Secret 错误');
      return false;
    }
  } catch (error) {
    console.error('   ❌ 请求失败:', error.message);
    return false;
  }
  
  // 获取应用信息
  console.log('\n2️⃣ 获取应用信息...');
  try {
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/agent/get?access_token=${accessToken}&agentid=${agentId}`,
      { method: 'GET' }
    );
    
    const data = await response.json();
    
    if (data.errcode === 0) {
      console.log('   ✅ Agent ID 有效');
      console.log('   应用名称:', data.name);
      console.log('   应用ID:', data.agentid);
    } else {
      console.error('   ❌ 获取应用信息失败:', data.errmsg || `错误码: ${data.errcode}`);
      console.log('\n   常见错误:');
      console.log('   - 40014: AgentID 不存在或无权限');
      console.log('   - 60011: 没有权限访问该应用');
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
// 1. 从企业微信管理后台复制凭证
// 2. 修改下面的值并运行此脚本

const CORP_ID = 'wwxxxxxxxxxxxxxxxx';
const AGENT_ID = '1000002';
const SECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

console.log('=====================================');
console.log('   企业微信连接器凭证测试工具');
console.log('=====================================\n');

testWeComCredentials(CORP_ID, AGENT_ID, SECRET);
