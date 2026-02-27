/**
 * 飞书文档处理器
 * 
 * 负责检测和读取飞书文档内容
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { getErrorMessage } from '../../../shared/utils/error-handler';

/**
 * 文档信息
 */
export interface DocumentInfo {
  documentId: string;
  title: string;
  content: string;
  url: string;
}

/**
 * 飞书文档处理器
 */
export class FeishuDocumentHandler {
  private client: Lark.Client;
  
  constructor(client: Lark.Client) {
    this.client = client;
  }
  
  /**
   * 从消息中提取文档链接
   * 
   * 支持的格式：
   * - https://xxx.feishu.cn/docx/xxxxx
   * - https://xxx.feishu.cn/docs/xxxxx
   * - https://xxx.feishu.cn/wiki/xxxxx
   * - https://xxx.feishu.cn/sheets/xxxxx
   */
  extractDocumentUrls(text: string): string[] {
    const urlPattern = /https:\/\/[^\/]+\.feishu\.cn\/(docx|docs|wiki|sheets)\/[^\s]+/g;
    const matches = text.match(urlPattern);
    return matches || [];
  }
  
  /**
   * 从 URL 中提取文档 ID
   */
  private extractDocumentId(url: string): string | null {
    // 匹配 /docx/xxxxx 或 /docs/xxxxx 等格式
    const match = url.match(/\/(docx|docs|wiki|sheets)\/([^\/\s?#]+)/);
    return match ? match[2] : null;
  }
  
  /**
   * 读取文档内容
   */
  async readDocument(url: string): Promise<DocumentInfo | null> {
    console.log('[FeishuDocumentHandler] 📖 开始读取文档:', url);
    
    try {
      // 1. 提取文档 ID
      const documentId = this.extractDocumentId(url);
      if (!documentId) {
        console.error('[FeishuDocumentHandler] ❌ 无法提取文档 ID:', url);
        return null;
      }
      
      console.log('[FeishuDocumentHandler] 文档 ID:', documentId);
      
      // 2. 获取文档元信息
      console.log('[FeishuDocumentHandler] 🔄 正在获取文档元信息...');
      const metaRes = await this.client.docx.document.get({
        path: {
          document_id: documentId,
        },
      });
      
      console.log('[FeishuDocumentHandler] 元信息响应:', {
        code: metaRes?.code,
        msg: metaRes?.msg,
        hasData: !!metaRes?.data,
      });
      
      if (!metaRes || metaRes.code !== 0) {
        console.error('[FeishuDocumentHandler] ❌ 获取文档元信息失败:', {
          code: metaRes?.code,
          msg: metaRes?.msg,
          url,
        });
        
        if (metaRes?.code === 99991663) {
          console.error('[FeishuDocumentHandler] 💡 权限不足，请在飞书开放平台添加以下权限:');
          console.error('[FeishuDocumentHandler]    - docx:document:readonly');
          console.error('[FeishuDocumentHandler]    - drive:drive:readonly');
        }
        
        return null;
      }
      
      const title = metaRes.data?.document?.title || '未命名文档';
      console.log('[FeishuDocumentHandler] ✅ 文档标题:', title);
      
      // 3. 获取文档原始内容
      console.log('[FeishuDocumentHandler] 🔄 正在获取文档内容...');
      const contentRes = await this.client.docx.document.rawContent({
        path: {
          document_id: documentId,
        },
      });
      
      console.log('[FeishuDocumentHandler] 内容响应:', {
        code: contentRes?.code,
        msg: contentRes?.msg,
        hasData: !!contentRes?.data,
      });
      
      if (!contentRes || contentRes.code !== 0) {
        console.error('[FeishuDocumentHandler] ❌ 获取文档内容失败:', {
          code: contentRes?.code,
          msg: contentRes?.msg,
          url,
        });
        return null;
      }
      
      const content = contentRes.data?.content || '';
      console.log('[FeishuDocumentHandler] ✅ 文档内容长度:', content.length);
      
      return {
        documentId,
        title,
        content,
        url,
      };
    } catch (error) {
      console.error('[FeishuDocumentHandler] ❌ 读取文档异常:', {
        url,
        error: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }
  
  /**
   * 批量读取文档
   */
  async readDocuments(urls: string[]): Promise<DocumentInfo[]> {
    const results: DocumentInfo[] = [];
    
    for (const url of urls) {
      const doc = await this.readDocument(url);
      if (doc) {
        results.push(doc);
      }
    }
    
    return results;
  }
  
  /**
   * 格式化文档内容为消息附加内容
   */
  formatDocumentContent(docs: DocumentInfo[]): string {
    if (docs.length === 0) {
      return '';
    }
    
    const parts: string[] = [];
    
    parts.push('\n\n--- 飞书文档内容 ---\n');
    
    for (const doc of docs) {
      parts.push(`\n【${doc.title}】`);
      parts.push(`链接: ${doc.url}`);
      parts.push(`\n内容:\n${doc.content}\n`);
      parts.push('---\n');
    }
    
    return parts.join('\n');
  }
}
