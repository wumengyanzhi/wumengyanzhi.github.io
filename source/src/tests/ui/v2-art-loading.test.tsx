import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_MAP } from '../../v2/data';
import { CardArt } from '../../v2/ui/card-art';

const character = CARD_MAP['three_kingdoms.character.xia_hou_dun']!;
const weapon = CARD_MAP['three_kingdoms.weapon.zhen_jun_yi_dao']!;

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('artwork loading on an unreliable connection', () => {
  it('retries a failed download and restores the illustration without reloading the game', () => {
    const { container } = render(<CardArt definition={character} />);
    const image = container.querySelector('img')!;
    const firstRequest = image.src;
    fireEvent.error(image);
    expect(screen.getByText(character.glyph)).toBeTruthy();

    act(() => vi.advanceTimersByTime(1000));
    expect(image.src).not.toBe(firstRequest);
    fireEvent.load(image);
    expect(screen.queryByText(character.glyph)).toBeNull();
    expect(screen.getByRole('img').style.backgroundImage).toContain(image.getAttribute('src'));
  });

  it('limits automatic retries while retaining the readable card fallback', () => {
    const { container } = render(<CardArt definition={character} />);
    const image = container.querySelector('img')!;
    const requests = new Set([image.src]);
    for (const delay of [1000, 3000, 8000]) {
      fireEvent.error(image);
      act(() => vi.advanceTimersByTime(delay));
      requests.add(image.src);
    }
    expect(requests.size).toBe(4);
    fireEvent.error(image);
    const finalRequest = image.src;
    act(() => vi.advanceTimersByTime(60000));
    expect(image.src).toBe(finalRequest);
    expect(screen.getByText(character.glyph)).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a pending retry when the card leaves the screen', () => {
    const { container, unmount } = render(<CardArt definition={character} />);
    fireEvent.error(container.querySelector('img')!);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loads a different atlas normally when the displayed card changes after an error', () => {
    const { container, rerender } = render(<CardArt definition={character} />);
    fireEvent.error(container.querySelector('img')!);
    rerender(<CardArt definition={weapon} />);
    const image = container.querySelector('img')!;
    fireEvent.load(image);
    expect(image.src).toContain('/art/objects.');
    expect(screen.queryByText(weapon.glyph)).toBeNull();
    expect(screen.getByRole('img').style.backgroundImage).toContain(image.getAttribute('src'));
    expect(vi.getTimerCount()).toBe(0);
  });
});
