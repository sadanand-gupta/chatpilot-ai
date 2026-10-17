import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrawlJob } from '@chatpilot/shared';
import { DEFAULT_PLANS } from '@chatpilot/shared';
import { makeChatbot, renderWithProviders } from './test-utils';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, get: getMock, post: postMock } };
});

import { CrawlPanel } from './CrawlPanel';

const job: CrawlJob = {
  id: 'job_1',
  chatbotId: 'bot_1',
  ownerId: 'u1',
  startUrl: 'https://acme.example',
  status: 'completed',
  stats: { discovered: 14, processed: 9, skipped: 3, failed: 2 },
  pages: [
    { url: 'https://acme.example/', status: 'processed', title: 'Home', chars: 2400 },
    { url: 'https://acme.example/cart', status: 'skipped', reason: 'Excluded path' },
    { url: 'https://acme.example/broken', status: 'failed', reason: 'HTTP 500' },
  ],
  maxPages: 15,
  hint: 'Very little text was found — this site may render its content with JavaScript.',
  createdAt: '2026-10-17T10:00:00.000Z',
};

function route(path: string) {
  if (path === '/me') return Promise.resolve({ user: {}, plan: DEFAULT_PLANS[0], usage: {} });
  if (path === '/chatbots/bot_1') return Promise.resolve(makeChatbot());
  if (path.startsWith('/chatbots/bot_1/crawl-jobs?')) return Promise.resolve({ items: [job], nextCursor: null });
  if (path === '/chatbots/bot_1/crawl-jobs/job_1') return Promise.resolve(job);
  if (path.startsWith('/chatbots/bot_1/sources')) return Promise.resolve({ items: [], nextCursor: null });
  return Promise.reject(new Error(`unexpected GET ${path}`));
}

describe('CrawlPanel', () => {
  beforeEach(() => {
    getMock.mockReset().mockImplementation(route);
    postMock.mockReset();
  });

  it('shows progress counters, page results and the job hint with a manual-content action', async () => {
    const onAddManual = vi.fn();
    const onContinue = vi.fn();
    renderWithProviders(<CrawlPanel chatbot={makeChatbot()} onAddManual={onAddManual} onContinue={onContinue} />);

    await waitFor(() => expect(screen.getByTestId('crawl-counter-discovered')).toHaveTextContent('14'));
    expect(screen.getByTestId('crawl-counter-processed')).toHaveTextContent('9');
    expect(screen.getByTestId('crawl-counter-skipped')).toHaveTextContent('3');
    expect(screen.getByTestId('crawl-counter-failed')).toHaveTextContent('2');
    expect(screen.getByText('HTTP 500', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Crawl progress' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/crawl(ing)? (completed|complete|finished)/i)).toHaveTextContent('Crawl completed — read 9 pages from your site');

    const hint = screen.getByTestId('crawl-hint');
    expect(hint).toHaveTextContent(/render its content with JavaScript/);
    await userEvent.click(hint.querySelector('button')!);
    expect(onAddManual).toHaveBeenCalled();

    // Completed with processed pages → continue is enabled.
    expect(screen.getByRole('button', { name: /Review knowledge/ })).toBeEnabled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('auto-starts a crawl when the chatbot has never been crawled and polls the job', async () => {
    const running: CrawlJob = { ...job, id: 'job_2', status: 'running', stats: { discovered: 4, processed: 1, skipped: 0, failed: 0 }, hint: undefined, pages: [] };
    getMock.mockImplementation((path: string) => {
      if (path.startsWith('/chatbots/bot_1/crawl-jobs?')) return Promise.resolve({ items: [], nextCursor: null });
      if (path === '/chatbots/bot_1/crawl-jobs/job_2') return Promise.resolve(running);
      return route(path);
    });
    postMock.mockResolvedValue(running);
    renderWithProviders(<CrawlPanel chatbot={makeChatbot()} autoStart onContinue={() => {}} />);
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/chatbots/bot_1/crawl', { url: 'https://acme.example/', maxPages: undefined }));
    expect(postMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('crawl-counter-discovered')).toHaveTextContent('4'));
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review knowledge/ })).toBeDisabled();
  });
});
