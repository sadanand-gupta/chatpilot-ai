import { render, screen } from '@testing-library/react';
import { DeviceFrame, computeScale } from './DeviceFrame';

let observedWidth = 720;

class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    this.cb([{ contentRect: { width: observedWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

describe('DeviceFrame', () => {
  const original = globalThis.ResizeObserver;
  beforeEach(() => {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  it('renders the desktop viewport at 1440 wide and scales to fit the available width', () => {
    observedWidth = 720;
    render(
      <DeviceFrame device="desktop" url="https://acme.example/menu">
        <div>site</div>
      </DeviceFrame>,
    );
    expect(screen.getByTestId('device-scale-label')).toHaveTextContent('Desktop · 1440×900 · Scaled to 50%');
    expect(screen.getByTestId('device-frame-scaled').style.transform).toBe('scale(0.5)');
    expect(screen.getByText('acme.example')).toBeInTheDocument();
  });

  it('switches device and uses the true mobile viewport size', () => {
    observedWidth = 720;
    const { rerender } = render(
      <DeviceFrame device="desktop">
        <div>site</div>
      </DeviceFrame>,
    );
    rerender(
      <DeviceFrame device="mobile">
        <div>site</div>
      </DeviceFrame>,
    );
    expect(screen.getByTestId('preview-device')).toHaveAttribute('data-device', 'mobile');
    const vp = screen.getByTestId('device-viewport');
    expect(vp.style.width).toBe('390px');
    expect(vp.style.height).toBe('844px');
    // 418px-wide phone fits in 720px → never upscaled.
    expect(screen.getByTestId('device-scale-label')).toHaveTextContent('Mobile · 390×844 · Actual size');
  });

  it('respects maxHeight when computing scale', () => {
    // tablet frame = 878×1156; limited by height 578 → 0.5
    expect(computeScale('tablet', 2000, 578)).toBeCloseTo(0.5, 2);
    expect(computeScale('desktop', 0)).toBe(1);
  });
});
