/**
 * 检查钉钉连接器配置脚本
 * 用于查看数据库中保存的配置
 */

const path = require('path');
const fs = require('fs');

// 找到数据库文件
const homeDir = require('os').homedir();
const dbPaths = [
  path.join(homeDir, '.deepbot', 'data', 'system.db'),
  path.join(homeDir, '.deepbot', 'system.db'),
  path.join(process.cwd(), 'data', 'system.db'),
  path.join(process.cwd(), '.deepbot', 'data', 'system.db'),
];

let dbPath = null;
for (const p of dbPaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.error('❌ 找不到数据库文件，尝试以下路径:');
  dbPaths.forEach(p => console.log('  -', p));
  process.exit(1);
}

console.log('✅ 找到数据库:', dbPath);

// 使用 better-sqlite3 读取数据库
try {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);

  console.log('\n📋 连接器配置列表:');
  console.log('==================');
  
  const configs = db.prepare('SELECT * FROM connector_config').all();
  
  if (configs.length === 0) {
    console.log('暂无连接器配置');
  } else {
    configs.forEach(row => {
      console.log(`\n连接器: ${row.connector_id} (${row.connector_name})`);
      console.log(`  启用状态: ${row.enabled === 1 ? '✅ 已启用' : '❌ 未启用'}`);
      console.log(`  配置内容:`);
      try {
        const config = JSON.parse(row.config_json);
        console.log(JSON.stringify(config, null, 2).split('\n').map(l => '    ' + l).join('\n'));
      } catch (e) {
        console.log('    (解析失败):', row.config_json);
      }
      console.log(`  创建时间: ${new Date(row.created_at).toLocaleString()}`);
      console.log(`  更新时间: ${new Date(row.updated_at).toLocaleString()}`);
    });
  }

  console.log('\n📋 Pairing 记录:');
  console.log('==================');
  
  const pairings = db.prepare('SELECT * FROM connector_pairing').all();
  
  if (pairings.length === 0) {
    console.log('暂无 Pairing 记录');
  } else {
    pairings.forEach(row => {
      console.log(`\n  用户: ${row.user_name || row.user_id}`);
      console.log(`  配对码: ${row.pairing_code}`);
      console.log(`  状态: ${row.approved === 1 ? '✅ 已批准' : '⏳ 待批准'}`);
      console.log(`  创建时间: ${new Date(row.created_at).toLocaleString()}`);
    });
  }

  db.close();
} catch (error) {
  console.error('❌ 读取数据库失败:', error.message);
  console.log('\n请确保已安装 better-sqlite3:');
  console.log('  pnpm add better-sqlite3');
}
