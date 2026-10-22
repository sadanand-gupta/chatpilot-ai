import { act, fireEvent, render, screen } from '@testing-library/react';
import { INSTALL_DEMOS, InstallDemo, nextScriptSnippet } from './InstallDemo';

const embedCode = '<script\n  src="https://cdn.test/widget.js"\n  data-chatbot-id="pub_1"\n  data-api-url="https://api.test"\n  async\n></script>';

describe('InstallDemo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('has a walkthrough for every platform tab, each ending on the live site', () => {
    for (const id of ['html', 'wordpress', 'shopify', 'wix', 'webflow', 'gtm', 'react']) {
      expect(INSTALL_DEMOS[id]?.length).toBeGreaterThan(0);
      for (const d of INSTALL_DEMOS[id]) expect(d.scenes.at(-1)?.kind).toBe('site');
    }
  });

  it('autoplays through the steps, pastes the real embed code and stops at the end', () => {
    render(<InstallDemo platform="html" embedCode={embedCode} botName="Speedy" welcomeMessage="Hello there" primaryColor="#123456" />);
    const caption = screen.getByTestId('install-demo-caption');
    expect(caption).toHaveTextContent('1/4');

    act(() => vi.advanceTimersByTime(2800 + 4000));
    expect(caption).toHaveTextContent('2/4');
    expect(screen.getByText(/data-chatbot-id="pub_1"/)).toHaveTextContent(/^<script.*async ><\/script>$/);

    act(() => vi.advanceTimersByTime(30_000));
    expect(caption).toHaveTextContent('4/4');
    expect(screen.getByText('Speedy')).toBeInTheDocument();
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay walkthrough' })).toBeInTheDocument();
  });

  it('pauses, and jumps to a step when its progress segment is clicked', () => {
    render(<InstallDemo platform="wordpress" embedCode={embedCode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause walkthrough' }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId('install-demo-caption')).toHaveTextContent('1/6');

    fireEvent.click(screen.getByRole('button', { name: /^Step 4:/ }));
    expect(screen.getByTestId('install-demo-caption')).toHaveTextContent('4/6 Paste the embed code in the Footer box.');
    expect(screen.getByRole('button', { name: 'Pause walkthrough' })).toBeInTheDocument();
  });

  it('switches between variants on multi-platform tabs', () => {
    render(<InstallDemo platform="react" embedCode={embedCode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vite / CRA / Vue' }));
    expect(screen.getByRole('button', { name: 'Vite / CRA / Vue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('install-demo-caption')).toHaveTextContent('1/4');
  });

  it('turns the embed code into a Next.js <Script> element', () => {
    const s = nextScriptSnippet(embedCode);
    expect(s).toContain('<Script');
    expect(s).toContain('src="https://cdn.test/widget.js"');
    expect(s).toContain('data-chatbot-id="pub_1"');
    expect(s).toContain('data-api-url="https://api.test"');
    expect(s).toContain('strategy="afterInteractive"');
    expect(s).not.toContain('async');
  });
});
