import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createGameController } from '@app/game-controller';
import { createConfigRegistry } from '@config/config-registry';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

describe('最小可玩界面', () => {
  it('主菜单可以新开冒险，渲染八张手牌与五格出牌框', () => {
    const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
    render(<App controller={controller} registry={registry} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('神话三国 · 网页 MVP');
    fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));
    expect(screen.getAllByTestId('hand-card')).toHaveLength(8);
    expect(screen.getAllByTestId('play-slot')).toHaveLength(5);
    expect(screen.getByText(/黄巾/)).toBeTruthy();
  });

  it('点选手牌再点空格位只发送摆牌命令，点已占格位可收回', () => {
    const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
    render(<App controller={controller} registry={registry} />);
    fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));
    const instanceId = controller.state?.zones.hand[0];
    expect(instanceId).toBeDefined();
    fireEvent.click(screen.getAllByTestId('hand-card')[0]!);
    fireEvent.click(screen.getAllByTestId('play-slot')[0]!);
    expect(controller.state?.zones.playSlots[0]).toBe(instanceId);
    fireEvent.click(screen.getAllByTestId('play-slot')[0]!);
    expect(controller.state?.zones.hand).toContain(instanceId);
  });
});
