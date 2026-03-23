/**
 * Tab 管理 API 路由
 */

import { Router, Response, RequestHandler } from 'express';
import type { AuthRequest } from '../types';
import type { GatewayAdapter } from '../gateway-adapter';
import { getErrorMessage } from '../../shared/utils/error-handler';

export function createTabsRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  /**
   * GET /api/tabs
   * 获取所有 Tab
   */
  const getAllTabs: RequestHandler = async (req, res) => {
    try {
      const tabs = gatewayAdapter.getAllTabs();
      res.json({ tabs });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  /**
   * POST /api/tabs
   * 创建新 Tab
   */
  const createTab: RequestHandler = async (req, res) => {
    try {
      const { title } = req.body;
      const tab = await gatewayAdapter.createTab(title || '新对话');
      res.json({ tab });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  /**
   * GET /api/tabs/:tabId
   * 获取指定 Tab 信息
   */
  const getTab: RequestHandler = async (req, res) => {
    try {
      const { tabId } = req.params;
      const tab = gatewayAdapter.getTab(tabId as string);
      
      if (!tab) {
        res.status(404).json({ error: 'Tab 不存在' });
        return;
      }
      
      res.json({ tab });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  /**
   * DELETE /api/tabs/:tabId
   * 关闭指定 Tab
   */
  const closeTab: RequestHandler = async (req, res) => {
    try {
      const { tabId } = req.params;
      await gatewayAdapter.closeTab(tabId as string);
      res.json({ success: true, message: 'Tab 已关闭' });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  /**
   * POST /api/tabs/:tabId/messages
   * 发送消息到指定 Tab
   */
  const sendMessage: RequestHandler = async (req, res) => {
    try {
      const { tabId } = req.params;
      const { content, clearHistory } = req.body;
      
      if (!content) {
        res.status(400).json({ error: '消息内容不能为空' });
        return;
      }
      
      await gatewayAdapter.handleSendMessage(tabId as string, content, clearHistory);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  /**
   * GET /api/tabs/:tabId/messages
   * 获取 Tab 的消息历史
   */
  const getMessages: RequestHandler = async (req, res) => {
    try {
      const { tabId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const before = req.query.before as string;
      
      const messages = await gatewayAdapter.getMessages(tabId as string, { limit, before });
      res.json({ messages, hasMore: messages.length === limit });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  /**
   * POST /api/tabs/stop-generation
   * 停止生成
   */
  const stopGeneration: RequestHandler = async (req, res) => {
    try {
      const { sessionId } = req.body;
      await gatewayAdapter.stopGeneration(sessionId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  router.get('/', getAllTabs);
  router.post('/', createTab);
  router.get('/:tabId', getTab);
  router.delete('/:tabId', closeTab);
  router.post('/:tabId/messages', sendMessage);
  router.get('/:tabId/messages', getMessages);
  router.post('/stop-generation', stopGeneration);
  
  return router;
}
