import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PLANS } from '@chatpilot/shared';
import { makeChatbot, renderWithProviders } from './test-utils';

const { getMock, postMock, putMock, publicGetMock, mountSpy } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
  publicGetMock: vi.fn(),
  mountSpy: vi.fn(),
}));
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, get: getMock, post: postMock, put: putMock },
    publicApi: { ...actual.publicApi, get: publicGetMock },
  };
});
vi.mock('@/lib/widget', async (orig) => {
  const actual = await orig<typeof import('@/lib/widget')>();
  return {
    ...actual,
    useWidgetMount: (_ref: unknown, opts: unknown) => {
      if (opts) mountSpy(opts);
      return { status: 'ready', error: null, instance: null };
    },
  };
});

import { ChatbotConfigForm } from './ChatbotConfigForm';
import { CreateChatbotWizard } from './CreateChatbotWizard';
import { PreviewStudio } from './PreviewStudio';

const bot = makeChatbot({
  previewToken: 'ptok_123',
  siteMeta: { url: 'https://acme.example', siteName: 'Acme', navLinks: ['Pricing', 'Contact'], themeColor: '#C2410C', frameable: false },
});

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  getMock.mockReset().mockImplementation((path: string) => {
    if (path === '/me') return Promise.resolve({ user: {}, plan: DEFAULT_PLANS[0], usage: {} });
    if (path === '/chatbots/bot_1') return Promise.resolve(bot);
    return Promise.resolve({ items: [], nextCursor: null });
  });
  postMock.mockReset();
  putMock.mockReset();
  publicGetMock.mockReset().mockResolvedValue({ url: bot.websiteUrl, frameable: false, reason: 'X-Frame-Options: DENY' });
  mountSpy.mockReset();
});

describe('CreateChatbotWizard', () => {
  it('prefills from ?url=, creates the chatbot and moves to the crawl step', async () => {
    postMock.mockImplementation((path: string) => {
      if (path === '/chatbots') return Promise.resolve(bot);
      if (path === '/chatbots/bot_1/crawl') return Promise.resolve({ ...{ id: 'j1', chatbotId: 'bot_1', ownerId: 'u1', startUrl: bot.websiteUrl, status: 'queued', stats: { discovered: 0, processed: 0, skipped: 0, failed: 0 }, pages: [], maxPages: 15, createdAt: '' } });
      return Promise.reject(new Error(path));
    });
    renderWithProviders(<CreateChatbotWizard />, { route: '/app/chatbots/new?url=acme-bakery.example', path: '/app/chatbots/new' });
    const url = screen.getByLabelText('Website URL') as HTMLInputElement;
    await waitFor(() => expect(url.value).toBe('https://acme-bakery.example/'));
    expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe('Acme Bakery');
    await userEvent.click(screen.getByRole('button', { name: /Create chatbot/ }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/chatbots', {
        websiteUrl: 'https://acme-bakery.example/',
        businessName: 'Acme Bakery',
        category: '',
        language: 'auto',
      }),
    );
    expect(await screen.findByText('Reading your website')).toBeInTheDocument();
  });
});

describe('ChatbotConfigForm', () => {
  it('renders the live preview in preview mode and saves via PUT config', async () => {
    putMock.mockImplementation(async (_p: string, body: unknown) => ({ ...bot, config: body }));
    renderWithProviders(<ChatbotConfigForm chatbot={bot} />);
    expect(screen.getByTestId('config-live-preview')).toBeInTheDocument();
    expect(mountSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: 'preview', open: true }));
    const name = screen.getByLabelText('Bot name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Bready');
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Suggest from my site/ }));
    expect(screen.getByRole('button', { name: /How much do your services cost/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/chatbots/bot_1/config', expect.objectContaining({ botName: 'Bready' })));
  });
});

describe('PreviewStudio', () => {
  it('checks framing, shows the approximation and mounts the widget in draft preview mode per device', async () => {
    renderWithProviders(<PreviewStudio chatbot={bot} />);
    await waitFor(() => expect(publicGetMock).toHaveBeenCalledWith(`/public/frame-check?url=${encodeURIComponent(bot.websiteUrl)}`));
    expect(await screen.findByTestId('approximation-banner')).toBeInTheDocument();
    expect(mountSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: 'preview', forceMobile: false }));

    await userEvent.click(screen.getByRole('button', { name: /Mobile/ }));
    expect(screen.getByRole('button', { name: /Mobile/ })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(mountSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: 'preview', forceMobile: true, open: false })));

    // Published toggle is disabled for a draft bot.
    expect(screen.getByRole('button', { name: 'published' })).toBeDisabled();
    // Real-site preview instructions use the preview token.
    expect(screen.getByText(/chatpilot_preview=ptok_123/)).toBeInTheDocument();
    expect(screen.getByText(/data-preview-token="ptok_123"/)).toBeInTheDocument();
    expect(screen.getByTestId('preview-studio')).toBeInTheDocument();
    expect(screen.getByTestId('preview-device')).toHaveAttribute('data-device', 'mobile');
  });

  it('regenerates the preview token after confirmation', async () => {
    const rotated = { ...bot, previewToken: 'ptok_new' };
    postMock.mockResolvedValue(rotated);
    const baseGet = getMock.getMockImplementation()!;
    getMock.mockImplementation((path: string) =>
      path === '/chatbots/bot_1' && postMock.mock.calls.length > 0 ? Promise.resolve(rotated) : baseGet(path),
    );
    renderWithProviders(<PreviewStudio chatbot={bot} />);
    await userEvent.click(screen.getByRole('button', { name: /Regenerate preview token/ }));
    expect(postMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Regenerate$/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/chatbots/bot_1/preview-token/rotate'));
    expect(await screen.findByText(/chatpilot_preview=ptok_new/)).toBeInTheDocument();
  });
});
