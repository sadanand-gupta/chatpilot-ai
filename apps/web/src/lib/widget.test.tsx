import { StrictMode, useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { defaultChatbotConfig, type ChatbotConfig, type ChatPilotGlobal, type WidgetInstance } from '@chatpilot/shared';
import { __resetWidgetLoaderForTests, loadWidget, useWidgetMount } from './widget';

function makeGlobal() {
  const instance: WidgetInstance = {
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
  };
  const global: ChatPilotGlobal = { version: 'test', mount: vi.fn(() => instance) };
  return { instance, global };
}

function Harness({ config, device }: { config: ChatbotConfig; device: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useWidgetMount(ref, { mode: 'preview', config, sendPreview: async () => ({ content: 'ok' }) }, [device]);
  return (
    <div>
      <div ref={ref} data-testid="host" />
      <span data-testid="status">{state.status}</span>
    </div>
  );
}

describe('useWidgetMount', () => {
  afterEach(() => {
    delete (window as unknown as { ChatPilot?: unknown }).ChatPilot;
    __resetWidgetLoaderForTests();
  });

  it('calls update() instead of remounting when config changes, and remounts on deps change', async () => {
    const { instance, global } = makeGlobal();
    (window as unknown as { ChatPilot: ChatPilotGlobal }).ChatPilot = global;
    const c1 = defaultChatbotConfig();
    const { rerender, getByTestId, unmount } = render(
      <StrictMode>
        <Harness config={c1} device="desktop" />
      </StrictMode>,
    );
    await waitFor(() => expect(getByTestId('status').textContent).toBe('ready'));
    // StrictMode double effects must not leave two widgets mounted.
    expect(global.mount).toHaveBeenCalledTimes(1);
    expect(instance.destroy).not.toHaveBeenCalled();
    const opts = (global.mount as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.container).toBe(getByTestId('host'));
    expect(opts.mode).toBe('preview');

    const c2 = { ...c1, primaryColor: '#DC2626' };
    rerender(
      <StrictMode>
        <Harness config={c2} device="desktop" />
      </StrictMode>,
    );
    await waitFor(() => expect(instance.update).toHaveBeenCalledWith(c2));
    expect(global.mount).toHaveBeenCalledTimes(1);

    // Same content, new object identity -> no redundant update.
    const updates = (instance.update as ReturnType<typeof vi.fn>).mock.calls.length;
    rerender(
      <StrictMode>
        <Harness config={{ ...c2 }} device="desktop" />
      </StrictMode>,
    );
    expect((instance.update as ReturnType<typeof vi.fn>).mock.calls.length).toBe(updates);

    rerender(
      <StrictMode>
        <Harness config={c2} device="mobile" />
      </StrictMode>,
    );
    await waitFor(() => expect(global.mount).toHaveBeenCalledTimes(2));
    expect(instance.destroy).toHaveBeenCalledTimes(1);

    unmount();
    expect(instance.destroy).toHaveBeenCalledTimes(2);
  });
});

describe('loadWidget', () => {
  afterEach(() => {
    document.querySelectorAll('script[data-chatpilot-loader]').forEach((s) => s.remove());
    __resetWidgetLoaderForTests();
  });

  it('injects the script once and rejects with a clear error when it fails to load', async () => {
    const p1 = loadWidget('http://widget.test/widget.js', 5000);
    const p2 = loadWidget('http://widget.test/widget.js', 5000);
    expect(p1).toBe(p2);
    const scripts = document.querySelectorAll('script[data-chatpilot-loader]');
    expect(scripts).toHaveLength(1);
    scripts[0].dispatchEvent(new Event('error'));
    await expect(p1).rejects.toThrow(/Couldn't load the chat widget from http:\/\/widget\.test\/widget\.js/);
    // A failed load can be retried.
    expect(document.querySelectorAll('script[data-chatpilot-loader]')).toHaveLength(0);
  });

  it('times out with a clear message', async () => {
    vi.useFakeTimers();
    try {
      const p = loadWidget('http://widget.test/slow.js', 15000);
      const assertion = expect(p).rejects.toThrow(/Timed out after 15s/);
      await vi.advanceTimersByTimeAsync(15001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
