import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuotaNotice } from './QuotaNotice';
import { ApiError } from '@/lib/api';

function renderNotice(error: unknown) {
  return render(
    <MemoryRouter>
      <QuotaNotice error={error} />
    </MemoryRouter>,
  );
}

describe('QuotaNotice', () => {
  it('renders usage, limit, reset date and an upgrade link for quota errors', () => {
    const err = new ApiError({
      status: 402,
      code: 'quota_exceeded',
      message: 'Limit reached',
      details: { metric: 'messages', used: 1000, limit: 1000, resetAt: '2026-11-01T00:00:00.000Z', planId: 'starter' },
    });
    renderNotice(err);
    expect(screen.getByText('Plan limit reached')).toBeInTheDocument();
    const notice = screen.getByTestId('quota-notice');
    expect(notice).toHaveTextContent('1,000');
    expect(notice).toHaveTextContent('chat messages this month');
    expect(notice).toHaveTextContent('starter');
    expect(notice).toHaveTextContent('Nov 1, 2026');
    expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute('href', '/app/billing');
  });

  it('renders nothing for other errors', () => {
    const { container } = renderNotice(new ApiError({ status: 404, code: 'not_found', message: 'nope' }));
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = renderNotice(new Error('x'));
    expect(c2).toBeEmptyDOMElement();
    const { container: c3 } = renderNotice(null);
    expect(c3).toBeEmptyDOMElement();
  });
});
