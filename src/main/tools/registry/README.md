# 史丽慧小助理 工具开发指南

## 概述

史丽慧小助理 的所有工具都是**内置工具**，代码位于 `src/main/tools/` 目录。

本指南说明如何创建新的内置工具。

## 工具架构

### 关键概念

1. **工具代码**：在 `src/main/tools/` 中实现（如 `my-tool.ts`）
2. **配置文件**：（可选）在 `~/.slhbot/tools/<tool-name>/config.json` 中存储
3. **外部依赖**：（可选）在 `~/.slhbot/tools/<tool-name>/node_modules/` 中安装
4. **工具加载**：在 `tool-loader.ts` 的 `loadBuiltinTools()` 方法中导入

### 为什么这样设计？

- ✅ 所有工具代码在项目中，便于维护和版本控制
- ✅ 配置文件在用户目录，不影响代码仓库
- ✅ 外部依赖按需安装，不增加主项目体积
- ✅ 工具加载显式化，清晰可控

## 快速开始

### 1. 创建工具文件

在 `src/main/tools/` 目录创建工具文件（如 `my-tool.ts`）：

```typescript
import { Type } from '@sinclair/typebox';
import type { ToolPlugin } from './registry/tool-interface';

// 定义工具参数 Schema
const MyToolSchema = Type.Object({
  action: Type.String({ description: '操作类型' }),
  input: Type.String({ description: '输入内容' }),
});

// 导出工具插件
export const myToolPlugin: ToolPlugin = {
  // 工具元数据
  metadata: {
    id: 'my-tool',
    name: 'my_tool',
    description: '这是一个示例工具',
    version: '1.0.0',
    author: '史丽慧小助理 Team',
    category: 'custom',
  },
  
  // 创建工具实例
  create: (options) => {
    return {
      name: 'my_tool',
      label: '我的工具',
      description: '执行自定义操作',
      parameters: MyToolSchema,
      
      execute: async (toolCallId, params, signal) => {
        // 实现工具逻辑
        const { action, input } = params as any;
        
        // 检查是否被取消
        if (signal?.aborted) {
          const err = new Error('操作被取消');
          err.name = 'AbortError';
          throw err;
        }
        
        // 执行操作
        const result = `执行 ${action}: ${input}`;
        
        // 返回结果
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      },
    };
  },
};
```

### 2. 在 tool-loader.ts 中加载

编辑 `src/main/tools/registry/tool-loader.ts`：

```typescript
// 1. 导入工具
import { myToolPlugin } from '../my-tool';

// 2. 在 loadBuiltinTools() 方法中添加
private async loadBuiltinTools(configStore?: any): Promise<AgentTool[]> {
  const tools: AgentTool[] = [];
  
  try {
    // ... 其他工具 ...
    
    // 我的工具
    const myToolsResult = myToolPlugin.create({
      workspaceDir: this.workspaceDir,
      sessionId: this.sessionId,
      configStore,
    });
    
    const myTools = myToolsResult instanceof Promise 
      ? await myToolsResult 
      : myToolsResult;
    
    if (Array.isArray(myTools)) {
      tools.push(...myTools);
    } else {
      tools.push(myTools);
    }
  } catch (error) {
    console.error('❌ 加载内置工具失败:', error);
  }
  
  return tools;
}
```

### 3. 运行类型检查

```bash
cd slhbot
pnpm run type-check
```

### 4. 重启 史丽慧小助理

工具会自动加载并可用。

## 工具接口详解

### ToolPlugin 接口

```typescript
interface ToolPlugin {
  metadata: ToolMetadata;
  create(options: ToolCreateOptions): AgentTool | AgentTool[] | Promise<AgentTool | AgentTool[]>;
  validateConfig?(config: Record<string, any>): { valid: boolean; error?: string };
  initialize?(options: ToolCreateOptions): Promise<void> | void;
  cleanup?(): Promise<void> | void;
}
```

### ToolMetadata 元数据

```typescript
interface ToolMetadata {
  id: string;              // 唯一标识符（kebab-case）
  name: string;            // 工具名称（用于调用）
  description: string;     // 工具描述
  version: string;         // 版本号
  author?: string;         // 作者
  category?: string;       // 分类
  requiresConfig?: boolean; // 是否需要配置
  configSchema?: object;   // 配置 Schema
  icon?: string;           // 图标
  tags?: string[];         // 标签
}
```

### ToolCreateOptions 创建选项

```typescript
interface ToolCreateOptions {
  workspaceDir: string;    // 工作目录
  sessionId: string;       // 会话 ID
  config?: object;         // 工具配置
  configStore?: any;       // 系统配置存储
  dependencies?: object;   // 其他依赖
}
```

### AgentTool 工具实例

```typescript
interface AgentTool {
  name: string;            // 工具名称（用于调用）
  label: string;           // 显示标签
  description: string;     // 工具描述
  parameters: TSchema;     // 参数 Schema（TypeBox）
  execute: (
    toolCallId: string,
    params: any,
    signal?: AbortSignal
  ) => Promise<ToolResult>;
}
```

### ToolResult 返回结果

```typescript
interface ToolResult {
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    image?: string;
  }>;
  details?: Record<string, any>;
  isError?: boolean;
}
```

## 高级功能

### 1. 使用配置文件

如果工具需要配置（如 API Key），在工具执行时从用户目录读取：

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function loadConfig(workspaceDir: string) {
  // 配置文件查找顺序
  const configPaths = [
    join(workspaceDir, '.slhbot', 'tools', 'my-tool', 'config.json'),
    join(homedir(), '.slhbot', 'tools', 'my-tool', 'config.json'),
  ];
  
  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  }
  
  throw new Error('配置文件不存在');
}

// 在 execute 中使用
execute: async (toolCallId, params, signal) => {
  const config = loadConfig(options.workspaceDir);
  // 使用 config.apiKey 等
}
```

### 2. 动态加载外部依赖

如果工具需要外部依赖（如 nodemailer），使用动态加载避免打包：

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

async function loadDependency(): Promise<any> {
  const toolDir = join(homedir(), '.slhbot', 'tools', 'my-tool');
  
  try {
    // 从工具目录加载
    const depPath = join(toolDir, 'node_modules', 'some-package');
    if (existsSync(depPath)) {
      return require(depPath);
    }
    
    // 尝试从全局加载
    return require('some-package');
  } catch (error) {
    throw new Error(
      '依赖未安装\n\n' +
      '请运行以下命令安装：\n\n' +
      `  mkdir -p ${toolDir}\n` +
      `  cd ${toolDir}\n` +
      `  pnpm init -y\n` +
      `  pnpm add some-package\n`
    );
  }
}

// 在 execute 中使用
execute: async (toolCallId, params, signal) => {
  const dep = await loadDependency();
  // 使用依赖
}
```

### 3. 支持 AbortSignal

```typescript
execute: async (toolCallId, params, signal) => {
  // 在长时间操作前检查
  if (signal?.aborted) {
    const err = new Error('操作被取消');
    err.name = 'AbortError';
    throw err;
  }
  
  // 监听 abort 事件
  const abortHandler = () => {
    console.log('检测到取消信号');
    // 清理资源
  };
  
  if (signal) {
    signal.addEventListener('abort', abortHandler, { once: true });
  }
  
  try {
    // 执行操作...
    
    // 再次检查
    if (signal?.aborted) {
      const err = new Error('操作被取消');
      err.name = 'AbortError';
      throw err;
    }
    
    return { content: [{ type: 'text', text: '成功' }] };
  } finally {
    // 清理
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}
```

### 4. 返回多个工具

```typescript
create: (options) => {
  return [
    {
      name: 'tool_1',
      label: '工具 1',
      description: '第一个工具',
      parameters: Schema1,
      execute: async (toolCallId, params, signal) => {
        // 实现
      },
    },
    {
      name: 'tool_2',
      label: '工具 2',
      description: '第二个工具',
      parameters: Schema2,
      execute: async (toolCallId, params, signal) => {
        // 实现
      },
    },
  ];
}
```

## 示例工具

### 基础示例

查看 `example-tool.ts` - 基础工具模板

### 完整示例

查看 `email-tool.ts` - 带配置文件和外部依赖的完整示例：
- 从用户目录读取配置文件
- 动态加载外部依赖（nodemailer）
- 支持 AbortSignal 取消操作
- 提供友好的错误提示

### 其他内置工具

- `image-generation-tool.ts` - HTTP 请求示例
- `browser-tool.ts` - 复杂操作示例
- `memory-tool.ts` - 数据存储示例

## 最佳实践

1. **使用 TypeScript** - 提供类型安全
2. **添加详细描述** - 帮助 AI 理解工具用途
3. **支持 AbortSignal** - 允许用户取消操作
4. **错误处理** - 使用 `getErrorMessage()` 统一错误处理
5. **参数验证** - 使用 TypeBox Schema 验证参数
6. **日志记录** - 使用 console.log 记录关键操作
7. **配置文件** - 敏感信息放在用户目录的配置文件中
8. **外部依赖** - 使用动态加载，不打包到主项目
9. **超时配置** - 使用 `TIMEOUTS` 常量，不硬编码
10. **工具名称** - 使用 `TOOL_NAMES` 常量（如果适用）

## 工具分类

- `file` - 文件操作
- `network` - 网络请求
- `system` - 系统操作
- `ai` - AI 相关
- `custom` - 自定义

## 故障排除

### 工具未加载

- 检查是否在 `tool-loader.ts` 中导入和加载
- 检查是否导出正确的变量名（如 `myToolPlugin`）
- 查看控制台日志
- 运行 `pnpm run type-check` 检查类型错误

### 工具执行失败

- 检查参数 Schema 是否正确
- 检查 `execute` 方法是否返回正确格式
- 添加 try-catch 捕获错误
- 使用 `getErrorMessage()` 统一错误处理

### 配置文件未找到

- 检查配置文件路径是否正确
- 确认配置文件格式正确（有效的 JSON）
- 提供友好的错误提示，告诉用户如何创建配置文件

### 外部依赖加载失败

- 检查依赖是否已安装到 `~/.slhbot/tools/<tool-name>/node_modules/`
- 提供安装命令提示
- 考虑提供自动安装脚本（如 `install.sh`）

## 相关文件

- `tool-interface.ts` - 工具接口定义
- `tool-loader.ts` - 工具加载器
- `tool-registry.ts` - 工具注册表
- `example-tool.ts` - 示例工具模板
- `../email-tool.ts` - 完整示例

## 许可证

MIT License
