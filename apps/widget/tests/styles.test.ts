import { describe, expect, it } from 'vitest';
import { CSS, contrastRatio, themeVars } from '../src/styles';

describe('styles', () => {
  it('element resets have zero specificity so class rules (e.g. .launcher background) win', () => {
    // Regression: `.root button{background:none}` (0,1,1) beat `.launcher{background:...}` (0,1,0).
    expect(CSS).not.toMatch(/\.root (button|input|textarea|a|svg)\b/);
    expect(CSS).toContain(':where(.root) :where(button){');
    expect(CSS).toMatch(/\.launcher\{[^}]*background:var\(--cp-primary\)/);
    expect(CSS).toMatch(/\.send\{[^}]*background:var\(--cp-primary\)/);
    expect(CSS).toMatch(/\.btn\{[^}]*background:var\(--cp-primary\)/);
  });

  it('wraps long words/URLs only when needed', () => {
    expect(CSS).not.toContain('break-all');
    expect(CSS).toMatch(/\.bubble a\{[^}]*overflow-wrap:anywhere/);
  });

  it('chooses an accessible text colour on the primary colour', () => {
    for (const c of ['#4F46E5', '#0EA5E9', '#FDE047', '#16A34A', '#F97316', '#000000', '#FFFFFF']) {
      const v = themeVars(c);
      const other = v['--cp-on-primary'] === '#ffffff' ? '#111827' : '#ffffff';
      // the chosen text colour is always the higher-contrast option (user bubble, launcher, header)
      expect(contrastRatio(v['--cp-primary'], v['--cp-on-primary'])).toBeGreaterThanOrEqual(contrastRatio(v['--cp-primary'], other));
      expect(contrastRatio(v['--cp-primary'], v['--cp-on-primary'])).toBeGreaterThanOrEqual(3);
      // link/chip text derived from the primary is readable on white (AA)
      expect(contrastRatio(v['--cp-link'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
