import { describe, expect, it } from 'vitest';
import { mapConcurrent } from '../../src/lib/concurrent';

describe('상한이 있는 병렬 IO', () => {
  it('끝난 순서가 달라도 입력 순서를 지키고 동시성 상한을 넘지 않는다', async () => {
    let active = 0, peak = 0;
    const result = await mapConcurrent([3, 1, 2, 0], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, n));
      active--;
      return n * 2;
    });
    expect(result).toEqual([6, 2, 4, 0]); expect(peak).toBe(2); expect(active).toBe(0);
  });

  it('실패 뒤에는 새 IO를 시작하지 않고 이미 시작한 IO가 끝난 뒤 실패를 돌려준다', async () => {
    const started: number[] = [], ended: number[] = [];
    await expect(mapConcurrent([0, 1, 2, 3], 2, async (n) => {
      started.push(n);
      if (n === 0) throw new Error('합성 실패');
      await new Promise((resolve) => setTimeout(resolve, 1));
      ended.push(n);
    })).rejects.toThrow('합성 실패');
    expect(started).toEqual([0, 1]); expect(ended).toEqual([1]);
  });
});
