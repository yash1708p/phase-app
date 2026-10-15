import { useRef, type TouchEvent } from 'react';

/** Horizontal swipe → previous / next day. Ignores mostly-vertical scrolls and swipes that start on sliders. */
export function useDaySwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [data-no-swipe]')) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Date.now() - s.t > 600 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      if (dx > 0) onPrev();
      else onNext();
    },
  };
}
