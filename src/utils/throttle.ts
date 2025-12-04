/**
 * 创建一个节流函数，限制函数在指定时间间隔内最多执行一次
 * @param fn 需要节流的函数
 * @param delay 时间间隔（毫秒），默认1000ms
 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  delay: number = 1000
): T {
  let lastTime = 0;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastTime >= delay) {
      lastTime = now;
      fn(...args);
    }
  }) as T;
}
