import { screen, waitFor } from '@testing-library/react';
import { defaultChatbotConfig } from '@chatpilot/shared';
import { renderWithProviders } from '@/features/studio/test-utils';

const { getMock, mountSpy } = vi.hoisted(() => ({ getMock: vi.fn(), mountSpy: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, publicApi: { ...actual.publicApi, get: getMock } };
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

import { ApiError } from '@/lib/api';
import { HostedChatPage } from './HostedChatPage';

describe('HostedChatPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    mountSpy.mockReset();
  });

  it('shows a friendly page when the chatbot is not published', async () => {
    getMock.mockRejectedValue(new ApiError({ status: 403, code: 'not_published', message: 'Not published' }));
    renderWithProviders(<HostedChatPage />, { route: '/chat/pub_x', path: '/chat/:publicId' });
    expect(await screen.findByTestId('hosted-not_published')).toHaveTextContent('This chat is not available right now');
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(mountSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });

  it('shows not found for unknown ids', async () => {
    getMock.mockRejectedValue(new ApiError({ status: 404, code: 'not_found', message: 'Nope' }));
    renderWithProviders(<HostedChatPage />, { route: '/chat/missing', path: '/chat/:publicId' });
    expect(await screen.findByTestId('hosted-not_found')).toHaveTextContent('Chat not found');
  });

  it('sets the document title and mounts the widget in fullpage mode', async () => {
    getMock.mockResolvedValue({
      publicId: 'pub_1',
      businessName: 'Acme Bakery',
      version: 2,
      mode: 'published',
      config: defaultChatbotConfig({ primaryColor: '#C2410C' }),
    });
    renderWithProviders(<HostedChatPage />, { route: '/chat/pub_1', path: '/chat/:publicId' });
    expect(await screen.findByRole('heading', { name: 'Chat with Acme Bakery' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/public/chatbots/pub_1/config');
    await waitFor(() => expect(document.title).toBe('Chat with Acme Bakery'));
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#C2410C');
    expect(screen.getByText(/Messages are processed by AI and stored by Acme Bakery/)).toBeInTheDocument();
    // The widget's fullpage mode renders the branded header — no duplicate page header.
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(mountSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fullpage', publicId: 'pub_1', channel: 'hosted' }));
  });
});
