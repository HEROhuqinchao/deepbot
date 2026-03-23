/**
 * Skill 管理路由
 * 
 * 提供 Skill 的列表、搜索、安装、卸载、信息查询等功能
 */

import { Router } from 'express';
import type { GatewayAdapter } from '../gateway-adapter';

export function createSkillsRouter(gatewayAdapter: GatewayAdapter): Router {
  const router = Router();
  
  // Skill 管理（统一入口）
  router.post('/', async (req, res) => {
    try {
      const request = req.body;
      
      if (!request || !request.action) {
        return res.status(400).json({ 
          success: false, 
          error: '缺少 action 参数' 
        });
      }
      
      const result = await gatewayAdapter.skillManager(request);
      res.json(result);
    } catch (error) {
      console.error('Skill 管理操作失败:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : '操作失败' 
      });
    }
  });
  
  return router;
}
