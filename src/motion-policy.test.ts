import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./motion.css', import.meta.url), 'utf8');

describe('RAIDE motion safety contract', () => {
  it('honors reduced-motion preferences for workspace and evidence animations', () => {
    const fallback = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(fallback).toContain('animation: none !important');
    expect(fallback).toContain('raide-app [data-raide-motion]');
    expect(fallback).toContain('.traffic-stage > *');
  });

  it('never runs continuous or autonomous decorative animations', () => {
    expect(styles).not.toMatch(/\banimation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/i);
    expect(styles).not.toMatch(/\banimation-delay\s*:/i);
    expect(styles).toContain("[data-raide-motion='new-evidence']");
  });

  it('defines a bounded visual response for explicit train selection', () => {
    expect(styles).toContain('.rail-train-marker.active');
    expect(styles).toContain('.heat-cell.selected');
    expect(styles).toContain('.queue-item.chosen');
    expect(styles).toContain('var(--raide-motion-slow)');
  });
});
