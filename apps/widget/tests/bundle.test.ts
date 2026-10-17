import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Smoke-tests the *built* bundle (property mangling + minification). Run `node build.mjs` first.
const file = fileURLToPath(new NodeURL('../dist/widget.js', import.meta.url));
const built = existsSync(file);

describe.skipIf(!built)('dist/widget.js', () => {
  const saved = window.ChatPilot;
  afterAll(() => {
    window.ChatPilot?.instances().forEach((i) => i.destroy());
    window.ChatPilot = saved;
    document.body.innerHTML = '';
  });

  it('installs window.ChatPilot and renders a working preview widget', async () => {
    delete window.ChatPilot;
    new Function(readFileSync(file, 'utf8'))();
    const cp = window.ChatPilot!;
    expect(typeof cp.version).toBe('string');
    const box = document.createElement('div');
    document.body.append(box);
    const sendPreview = vi.fn(async (m: string) => ({ content: `**Echo** ${m}` }));
    const inst = cp.mount({
      apiUrl: 'http://x',
      mode: 'preview',
      container: box,
      open: true,
      config: { primaryColor: '#16A34A', headerTitle: 'Bundle test' } as never,
      sendPreview,
    });
    const root = box.querySelector('chatpilot-widget')!.shadowRoot!;
    expect(root.querySelector('.title')!.textContent).toBe('Bundle test');
    expect(root.querySelector('.panel')!.getAttribute('role')).toBe('dialog');
    const input = root.querySelector('textarea')!;
    input.value = 'hi';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let i = 0; i < 50 && root.querySelectorAll('[data-testid=message-assistant]').length < 2; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const bubbles = root.querySelectorAll('[data-testid=message-assistant]');
    expect(bubbles[1].querySelector('strong')!.textContent).toBe('Echo');
    inst.update({ primaryColor: '#000000', headerTitle: 'Updated' } as never);
    expect(root.querySelector('.title')!.textContent).toBe('Updated');
    inst.destroy();
    expect(box.querySelector('chatpilot-widget')).toBeNull();
  });
});
