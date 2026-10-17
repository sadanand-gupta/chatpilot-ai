import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from './SafeMarkdown';

describe('SafeMarkdown', () => {
  it('renders paragraphs, bold labels, bullet lists and safe links', () => {
    const { container } = render(
      <SafeMarkdown
        text={'We build ATS-friendly resumes.\n\n- **Resume Builder:** ready in minutes\n- **ATS Check:** free score\n\nStart here: [Resume Builder](https://www.jobwala.io/resume-builder)'}
      />,
    );
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'Resume Builder: ready in minutes',
      'ATS Check: free score',
    ]);
    expect(container.querySelector('li strong')!.textContent).toBe('Resume Builder:');
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://www.jobwala.io/resume-builder');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('renders numbered lists as <ol>', () => {
    const { container } = render(<SafeMarkdown text={'1. Upload\n2. Pick a plan'} />);
    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('never renders HTML or unsafe links', () => {
    const { container } = render(
      <SafeMarkdown text={'<img src=x onerror=alert(1)> [click](javascript:alert(1)) [data](data:text/html,hi)'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('click');
  });
});
