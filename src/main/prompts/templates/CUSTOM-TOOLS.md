# 自定义工具使用指南

本文件包含第三方插件工具的使用说明。

---

## Email（邮件发送工具）

**使用场景**：
- ✅ 发送通知邮件、报告邮件
- ✅ 发送带附件的邮件
- ✅ 发送 HTML 格式的邮件
- ✅ 发送带抄送/密送的邮件
- ❌ 不要用于批量营销邮件（可能被封号）
- ❌ 不要发送敏感信息（邮件不加密）

**⚠️ 配置文件路径（重要）**:

邮件工具会按以下顺序查找配置文件：
1. 项目级别：`<workspace>/.deepbot/tools/email-tool/config.json`
2. 用户级别：`~/.deepbot/tools/email-tool/config.json`

**配置文件格式**：
```json
{
  "user": "your-email@example.com",
  "password": "your-password-or-auth-code",
  "smtpServer": "smtp.example.com",
  "smtpPort": 465,
  "useSsl": true,
  "fromName": "Your Name"
}
```

### send_email
**用途**: 通过 SMTP 发送邮件

**参数**:
- `to`: 收件人邮箱（多个用逗号分隔）
- `subject`: 邮件主题
- `body`: (可选) 邮件正文内容
- `bodyFile`: (可选) 邮件正文文件路径（与 body 二选一）
- `html`: (可选) 是否为 HTML 邮件，默认 false
- `attachments`: (可选) 附件文件路径数组
- `cc`: (可选) 抄送邮箱（多个用逗号分隔）
- `bcc`: (可选) 密送邮箱（多个用逗号分隔）

**示例**:

1. 发送简单文本邮件：
```json
{
  "to": "recipient@example.com",
  "subject": "测试邮件",
  "body": "这是一封测试邮件"
}
```

2. 发送 HTML 邮件：
```json
{
  "to": "team@company.com",
  "subject": "项目进度报告",
  "body": "<h1>项目进度</h1><ul><li>功能 A：已完成</li><li>功能 B：进行中</li></ul>",
  "html": true
}
```

3. 发送带附件的邮件：
```json
{
  "to": "client@example.com",
  "subject": "合同文件",
  "body": "请查收附件中的合同",
  "attachments": [
    "~/Documents/contract.pdf",
    "~/Documents/invoice.xlsx"
  ]
}
```

4. 发送带抄送的邮件：
```json
{
  "to": "manager@company.com",
  "cc": "team@company.com,hr@company.com",
  "subject": "请假申请",
  "body": "申请明天请假一天"
}
```

5. 从文件读取邮件正文：
```json
{
  "to": "newsletter@example.com",
  "subject": "月度通讯",
  "bodyFile": "~/Documents/newsletter.html",
  "html": true
}
```

**⚠️ 错误处理**:

如果工具返回错误，根据错误信息告知用户：

1. **"nodemailer 未安装"**:
   - 告诉用户：邮件工具依赖未安装，需要运行安装脚本或手动安装 nodemailer
   - 正确路径：`~/.deepbot/tools/email-tool/`

2. **"邮件工具未配置"** 或 **"请创建配置文件"**:
   - 告诉用户：需要创建配置文件
   - 正确路径：`~/.deepbot/tools/email-tool/config.json`
   - 配置示例：参考上面的配置文件格式

3. **"认证失败"**:
   - 告诉用户：邮箱认证失败，请检查配置中的账号和密码/授权码
   - QQ 邮箱：必须使用授权码（不是 QQ 密码）
   - Gmail：必须使用应用专用密码

4. **"连接超时"** 或 **"连接被拒绝"**:
   - 告诉用户：无法连接到邮件服务器，请检查网络和 SMTP 配置

**⚠️ 注意事项**:
- 工具会自动处理错误并返回详细的错误信息
- 不要重复调用，如果失败一次就告知用户原因
- 附件路径必须是绝对路径或 `~` 开头的路径
- 配置文件路径是固定的，不要告诉用户错误的路径（如 `~/.deepbot/config/email.json`）

---

## Connector（连接器工具）

**使用场景**：
- ✅ 在连接器会话中发送图片到外部平台（如飞书）
- ✅ 在连接器会话中发送文件到外部平台（如飞书）
- ❌ 不能在普通会话中使用（仅限连接器会话）
- ❌ 不能在 UI 发起的会话中使用

**⚠️ 重要限制**:

这两个工具**仅在连接器会话中可用**。连接器会话是指：
- 从飞书发起的对话
- 从其他外部平台（如钉钉、企业微信等）发起的对话

如果在普通 UI 会话中调用这些工具，会返回错误："此工具仅在连接器会话中可用"

**如何判断是否是连接器会话**：
- 如果用户是从飞书等外部平台发送消息，那就是连接器会话
- 如果用户是在 DeepBot Terminal UI 中发送消息，那就不是连接器会话

### connector_send_image
**用途**: 通过连接器发送图片到外部平台

**参数**:
- `imagePath`: 图片文件的绝对路径（必填）
- `caption`: (可选) 图片说明文字

**支持的图片格式**:
- JPG / JPEG
- PNG
- GIF
- BMP
- WebP

**示例**:

1. 发送图片（无说明）：
```json
{
  "imagePath": "/Users/username/Pictures/chart.png"
}
```

2. 发送图片（带说明）：
```json
{
  "imagePath": "/Users/username/Documents/report-chart.png",
  "caption": "这是本月的销售数据图表"
}
```

**⚠️ 错误处理**:

1. **"此工具仅在连接器会话中可用"**:
   - 告诉用户：这个功能只能在飞书等外部平台的对话中使用
   - 不能在 DeepBot Terminal 的 UI 中使用

2. **"图片文件不存在"**:
   - 告诉用户：指定的图片文件路径不存在
   - 请确认文件路径是否正确

3. **"不支持的图片格式"**:
   - 告诉用户：只支持 JPG、PNG、GIF、BMP、WebP 格式
   - 请转换图片格式后重试

### connector_send_file
**用途**: 通过连接器发送文件到外部平台

**参数**:
- `filePath`: 文件的绝对路径（必填）
- `fileName`: (可选) 自定义文件名，默认使用原文件名

**支持的文件类型**:
- 任意文件类型（PDF、Word、Excel、ZIP 等）

**示例**:

1. 发送文件（使用原文件名）：
```json
{
  "filePath": "/Users/username/Documents/report.pdf"
}
```

2. 发送文件（自定义文件名）：
```json
{
  "filePath": "/Users/username/Documents/monthly-report-2024-02.pdf",
  "fileName": "2月份报告.pdf"
}
```

**⚠️ 错误处理**:

1. **"此工具仅在连接器会话中可用"**:
   - 告诉用户：这个功能只能在飞书等外部平台的对话中使用
   - 不能在 DeepBot Terminal 的 UI 中使用

2. **"文件不存在"**:
   - 告诉用户：指定的文件路径不存在
   - 请确认文件路径是否正确

3. **"路径不是文件"**:
   - 告诉用户：指定的路径是一个目录，不是文件
   - 请提供文件的完整路径

**⚠️ 使用建议**:

1. **配合 file_read 工具使用**:
   - 先使用 `file_read` 读取文件内容
   - 确认文件存在后再发送

2. **路径处理**:
   - 使用绝对路径（如 `/Users/username/Documents/file.pdf`）
   - 或使用 `~` 开头的路径（如 `~/Documents/file.pdf`）

3. **文件大小**:
   - 注意外部平台可能有文件大小限制
   - 飞书单个文件限制通常为 20MB

4. **典型使用场景**:
   - 用户要求："把这个图片发给我"
   - 用户要求："发送这个文档"
   - 用户要求："把刚才生成的图表发到飞书"

---
