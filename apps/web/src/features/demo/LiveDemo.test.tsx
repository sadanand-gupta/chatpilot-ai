import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DemoSession } from '@chatpilot/shared';
import { renderWithProviders } from '@/features/studio/test-utils';

const { getMock, postMock, mountSpy } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(), mountSpy: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, publicApi: { ...actual.publicApi, get: getMock, post: postMock } };
});
vi.mock('@/lib/widget', async (orig) => {
  const actual = await orig<typeof import('@/lib/widget')>();
  return {
    ...actual,
    loadWidget: vi.fn(),
    useWidgetMount: (_ref: unknown, opts: unknown) => {
      if (opts) mountSpy(opts);
      return { status: 'ready', error: null, instance: null };
    },
  };
});

import { ApiError } from '@/lib/api';
import { LiveDemo } from './LiveDemo';

const base: DemoSession = {
  demoId: 'demo_1',
  publicId: 'demo_pub_1',
  url: 'https://acme.example/',
  status: 'crawling',
  pagesProcessed: 0,
  expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
};

describe('LiveDemo', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    mountSpy.mockReset();
  });

  it('shows an example before running, then submit → polling → ready renders desktop and mobile frames', async () => {
    postMock.mockResolvedValue(base);
    getMock
      .mockResolvedValueOnce({ ...base, pagesProcessed: 3, siteMeta: { url: base.url, siteName: 'Acme', frameable: false } })
      .mockResolvedValue({ ...base, status: 'ready', pagesProcessed: 6, siteMeta: { url: base.url, siteName: 'Acme', frameable: false } });

    renderWithProviders(<LiveDemo />);
    expect(screen.getByTestId('demo-example')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Enter your website URL'), 'acme.example');
    await userEvent.click(screen.getByRole('button', { name: /See it on my site/ }));
    expect(postMock).toHaveBeenCalledWith('/public/demo', { url: 'https://acme.example/' });

    expect(await screen.findByTestId('demo-progress')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Reading pages \(3\)/)).toBeInTheDocument());

    expect(await screen.findByTestId('demo-ready', {}, { timeout: 5000 })).toBeInTheDocument();
    const frames = screen.getAllByTestId('preview-device');
    expect(frames.map((f) => f.getAttribute('data-device'))).toEqual(['desktop', 'mobile']);
    expect(getMock).toHaveBeenCalledWith('/public/demo/demo_1');
    expect(screen.getByText(/Demo expires in/)).toBeInTheDocument();
    expect(screen.getByText('Tap to chat')).toBeInTheDocument();

    const opts = mountSpy.mock.calls.map((c) => c[0] as { publicId: string; channel: string; forceMobile?: boolean; open?: boolean });
    expect(opts.some((o) => o.publicId === 'demo_pub_1' && o.channel === 'demo' && o.open === true && !o.forceMobile)).toBe(true);
    expect(opts.some((o) => o.publicId === 'demo_pub_1' && o.forceMobile === true && o.open === false)).toBe(true);

    const cta = screen.getByRole('link', { name: /Create your chatbot for free/ });
    expect(cta.getAttribute('href')).toBe(
      `/register?next=${encodeURIComponent(`/app/chatbots/new?url=${encodeURIComponent('https://acme.example/')}`)}`,
    );
  }, 10000);

  it('explains rate limiting', async () => {
    postMock.mockRejectedValue(new ApiError({ status: 429, code: 'rate_limited', message: 'Too many' }));
    renderWithProviders(<LiveDemo compact />);
    await userEvent.type(screen.getByLabelText('Enter your website URL'), 'acme.example');
    await userEvent.click(screen.getByRole('button', { name: /See it on my site/ }));
    expect(await screen.findByText('Too many demos from your network')).toBeInTheDocument();
  });

  it('validates the URL client-side', async () => {
    renderWithProviders(<LiveDemo />);
    await userEvent.type(screen.getByLabelText('Enter your website URL'), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: /See it on my site/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Enter your website address/);
    expect(postMock).not.toHaveBeenCalled();
  });
});
