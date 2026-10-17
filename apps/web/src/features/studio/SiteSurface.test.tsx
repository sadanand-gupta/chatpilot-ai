import { render, screen } from '@testing-library/react';
import { SiteSurface } from './SiteSurface';

const meta = {
  url: 'https://acme.example',
  siteName: 'Acme Bakery',
  heroHeading: 'Fresh bread daily',
  navLinks: ['Menu', 'About', 'Contact'],
  themeColor: '#C2410C',
};

describe('SiteSurface', () => {
  it('shows the approximation banner and mockup when the site is not frameable', () => {
    render(<SiteSurface url="https://acme.example" siteMeta={meta} device="desktop" frameable={false} />);
    expect(screen.queryByTestId('site-iframe')).not.toBeInTheDocument();
    expect(screen.getByTestId('approximation-banner')).toHaveTextContent(/Your site blocks embedding \(X-Frame-Options\/CSP\)/);
    expect(screen.getByText('Fresh bread daily')).toBeInTheDocument();
    expect(screen.getByText('Menu')).toBeInTheDocument();
  });

  it('renders a sandboxed iframe at the real URL when frameable', () => {
    render(<SiteSurface url="https://acme.example" siteMeta={meta} device="mobile" frameable />);
    const iframe = screen.getByTestId('site-iframe');
    expect(iframe).toHaveAttribute('src', 'https://acme.example/');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByTestId('approximation-banner')).not.toBeInTheDocument();
  });

  it('never frames non-http(s) URLs', () => {
    render(<SiteSurface url="javascript:alert(1)" siteMeta={meta} device="desktop" frameable />);
    expect(screen.queryByTestId('site-iframe')).not.toBeInTheDocument();
    expect(screen.getByTestId('site-approximation')).toBeInTheDocument();
  });

  it('uses the screenshot as background when available', () => {
    const { container } = render(
      <SiteSurface url="https://acme.example" siteMeta={{ ...meta, screenshotUrl: 'https://cdn.example/shot.png' }} device="desktop" frameable={false} />,
    );
    expect(container.querySelector('img[src="https://cdn.example/shot.png"]')).not.toBeNull();
    expect(screen.getByTestId('approximation-banner')).toBeInTheDocument();
  });

  it('shows a loading state while the frame check runs', () => {
    render(<SiteSurface url="https://acme.example" device="desktop" frameable={undefined} />);
    expect(screen.getByTestId('site-surface-loading')).toBeInTheDocument();
  });
});
