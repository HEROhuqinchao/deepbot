/**
 * 时间格式化工具
 */

/**
 * 格式化持续时间（毫秒）为人类可读的格式
 * 
 * @param ms - 毫秒数
 * @returns 格式化后的字符串
 * 
 * @example
 * formatDuration(1500) // "1.5s"
 * formatDuration(65000) // "1m 5s"
 * formatDuration(3665000) // "1h 1m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  // 小于 1 分钟：显示秒（保留 1 位小数）
  if (seconds < 60) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  
  // 小于 1 小时：显示分钟和秒
  if (minutes < 60) {
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  // 1 小时以上：显示小时、分钟和秒
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;
  
  let result = `${hours}h`;
  if (remainingMinutes > 0) {
    result += ` ${remainingMinutes}m`;
  }
  if (remainingSeconds > 0) {
    result += ` ${remainingSeconds}s`;
  }
  
  return result;
}
