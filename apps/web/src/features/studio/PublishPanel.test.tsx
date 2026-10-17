import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublishResult } from '@chatpilot/shared';
import { makeChatbot, renderWithProviders } from './test-utils';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, get: getMock, post: postMock } };
});

import { ApiError } from '@/lib/api';
import { PublishPanel } from './PublishPanel';

const draft = makeChatbot();
const activeSource = { id: 's1', chatbotId: 'bot_1', ownerId: 'u1', type: 'page', title: 'Home', status: 'active', charCount: 100, chunkCount: 1, preview: '', createdAt: '', updatedAt: '' };

describe('PublishPanel', () => {
  let current = draft;
  beforeEach(() => {
    current = draft;
    getMock.mockReset().mockImplementation((path: string) => {
      if (path === '/chatbots/bot_1') return Promise.resolve(current);
      if (path.startsWith('/chatbots/bot_1/sources')) return Promise.resolve({ items: [activeSource], nextCursor: null });
      if (path === '/chatbots/bot_1/install-status') return Promise.resolve({ published: true, allowedOrigins: [] });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    postMock.mockReset();
  });

  it('shows the embed code only after a successful publish', async () => {
    const published = makeChatbot({ status: 'published', publishedVersion: 1, publishedAt: '2026-10-17T10:00:00.000Z' });
    const result: PublishResult = {
      chatbot: published,
      version: 1,
      publicId: 'pub_1',
      embedCode: '<script src="https://cdn.test/widget.js" data-chatbot-id="pub_1" async></script>',
      hostedUrl: 'https://app.test/chat/pub_1',
      widgetUrl: 'https://cdn.test/widget.js',
    };
    postMock.mockImplementation(async () => {
      current = published;
      return result;
    });

    renderWithProviders(<PublishPanel chatbot={draft} />);
    const button = await screen.findByRole('button', { name: /Publish chatbot/ });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByTestId('embed-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('published-badge')).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(postMock).toHaveBeenCalledWith('/chatbots/bot_1/publish');
    expect(await screen.findByTestId('embed-code')).toHaveTextContent('data-chatbot-id="pub_1"');
    expect(screen.getByTestId('published-badge')).toHaveTextContent('Published');
    expect(screen.getByText('https://app.test/chat/pub_1')).toBeInTheDocument();
    expect(await screen.findByTestId('install-not-detected')).toHaveTextContent('Not detected yet');
  });

  it('does not show the embed code when publishing fails', async () => {
    postMock.mockRejectedValue(new ApiError({ status: 500, code: 'internal', message: 'Boom' }));
    renderWithProviders(<PublishPanel chatbot={draft} />);
    const button = await screen.findByRole('button', { name: /Publish chatbot/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText('Publishing failed')).toBeInTheDocument();
    expect(screen.queryByTestId('embed-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('published-badge')).not.toBeInTheDocument();
  });
});
