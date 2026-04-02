# Slack 机器人配置指南

本文档介绍如何配置 DeepBot 的 Slack 连接器，使其能够通过 Slack 接收和发送消息。大约 5 ～ 10 分钟配置完成。

## 前置条件

- Slack 工作区管理员权限
- 可访问 [Slack API](https://api.slack.com) 的网络环境

## 配置步骤

### 1. 创建 Slack App

1. 访问 [Slack API](https://api.slack.com/apps)
2. 点击「Create New App」
3. 选择「From scratch」
4. 填写 App Name 和选择 Development Slack Workspace
5. 点击「Create App」

### 2. 配置 Socket Mode

Socket Mode 允许你的应用通过 WebSocket 接收事件，无需公网服务器：

1. 在应用设置页面，进入「Socket Mode」
2. 开启「Enable Socket Mode」
3. 点击「Generate Token」生成 App-Level Token
4. 记录生成的 `xapp-` 开头的 Token

### 3. 配置 OAuth & Permissions

1. 进入「OAuth & Permissions」页面
2. 在「Bot Token Scopes」添加以下权限：

| 权限 | 用途 |
|------|------|
| `app_mentions:read` | 读取 @机器人 消息 |
| `chat:write` | 发送消息 |
| `files:write` | 上传文件 |
| `files:read` | 读取文件 |
| `users:read` | 读取用户信息 |
| `channels:history` | 读取频道历史 |
| `groups:history` | 读取私有频道历史 |
| `im:history` | 读取私信历史 |
| `mpim:history` | 读取多人私信历史 |

3. 点击「Install to Workspace」安装应用
4. 授权后记录 `xoxb-` 开头的 Bot User OAuth Token

### 4. 配置事件订阅

1. 进入「Event Subscriptions」页面
2. 开启「Enable Events」
3. 在「Subscribe to bot events」添加以下事件：
   - `app_mention`：机器人在频道中被 @
   - `message.im`：收到私信
   - `message.groups`：收到私有频道消息
   - `message.channels`：收到公共频道消息

4. 开启 Socket Mode 后无需配置 Request URL

### 5. 获取 Signing Secret

1. 进入「Basic Information」页面
2. 在「App Credentials」部分找到「Signing Secret」
3. 点击「Show」显示并记录

### 6. 在 DeepBot 中配置

1. 打开 DeepBot 设置 → 外部通讯配置
2. 选择「Slack」标签页
3. 填写配置信息：
   - **Bot Token**：`xoxb-` 开头的 OAuth Token
   - **App Token**：`xapp-` 开头的 App-Level Token
   - **Signing Secret**：签名验证密钥
4. 点击「保存配置」
5. 点击「启动连接器」

### 7. 邀请机器人到频道

在 Slack 中，将机器人添加到需要使用的频道：

```
/invite @YourBotName
```

## 使用说明

### 私聊使用

1. 在 Slack 中点击机器人名称
2. 发送消息即可开始对话

### 频道使用

1. 将机器人邀请到频道
2. 在频道中 @机器人 发送消息

## 配置参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| Bot Token | ✅ | Bot User OAuth Token（xoxb-xxx） |
| App Token | ✅ | App-Level Token（xapp-xxx） |
| Signing Secret | ✅ | 签名验证密钥 |
| RequirePairing | ❌ | 是否需要配对授权，默认 false |

## 常见问题

### Q: 连接器启动失败？

1. 检查 Bot Token 和 App Token 格式是否正确
2. 确认 Socket Mode 已启用
3. 检查网络是否能访问 Slack API

### Q: 收不到消息？

1. 确认已订阅相关事件
2. 检查 Bot 是否已受邀加入频道
3. 确认 OAuth 权限已正确配置

### Q: 发送消息失败？

1. 检查是否有 `chat:write` 权限
2. 确认机器人已加入目标频道
3. 检查 Token 是否有效

### Q: Socket Mode 连接断开？

Socket Mode 连接会自动重连。如果频繁断开，检查网络稳定性。

## 相关链接

- [Slack API 文档](https://api.slack.com)
- [Socket Mode 文档](https://api.slack.com/apis/connections/socket)
- [Events API 文档](https://api.slack.com/apis/events-api)
- [OAuth Scopes 说明](https://api.slack.com/scopes)
