/**
 * 配置管理 API 路由
 */

import { Router, Response, RequestHandler } from 'express';
import type { AuthRequest } from '../types';
import type { GatewayAdapter } from '../gateway-adapter';
import { getErrorMessage } from '../../shared/utils/error-handler';

export function createConfigRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  /**
   * GET /api/config
   * 获取系统配置
   */
  const getConfig: RequestHandler = async (req, res) => {
    try {
      const config = await gatewayAdapter.getConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  /**
   * PUT /api/config
   * 更新系统配置
   */
  const updateConfig: RequestHandler = async (req, res) => {
    try {
      const updates = req.body;
      await gatewayAdapter.updateConfig(updates);
      res.json({ success: true, message: '配置已更新' });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  };
  
  router.get('/', getConfig);
  router.put('/', updateConfig);
  
  return router;
}
