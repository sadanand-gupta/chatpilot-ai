import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Lock, RotateCw } from 'lucide-react';
import { cn, hostnameOf } from '@/lib/utils';
import { DEVICES, type DeviceKind } from './lib';

/** Chrome added around the viewport by each frame (px, unscaled). */
const FRAME_CHROME: Record<DeviceKind, { x: number; top: number; bottom: number }> = {
  desktop: { x: 0, top: 44, bottom: 0 },
  tablet: { x: 22, top: 22, bottom: 22 },
  mobile: { x: 14, top: 14, bottom: 14 },
};

export function frameSize(device: DeviceKind) {
  const vp = DEVICES[device];
  const c = FRAME_CHROME[device];
  return { width: vp.width + c.x * 2, height: vp.height + c.top + c.bottom };
}

/** Scale that fits a frame into the available box (never upscales). */
export function computeScale(device: DeviceKind, availableWidth: number, maxHeight?: number): number {
  const { width, height } = frameSize(device);
  if (!availableWidth || availableWidth <= 0) return 1;
  let s = availableWidth / width;
  if (maxHeight && maxHeight > 0) s = Math.min(s, maxHeight / height);
  return Math.max(0.05, Math.min(1, s));
}

export interface DeviceFrameProps {
  device: DeviceKind;
  /** Shown in the desktop URL pill. */
  url?: string;
  /** Rendered at the TRUE device viewport size (e.g. 390×844), then scaled to fit. */
  children: ReactNode;
  /** Optional cap on the rendered (scaled) height in px. */
  maxHeight?: number;
  /** Show the "Scaled to 62%" caption. */
  showScale?: boolean;
  className?: string;
  /** Accessible label for the frame region. */
  label?: string;
  onReload?: () => void;
}

/**
 * Realistic device frame (browser window / tablet / phone) that renders its children
 * at the device's real CSS viewport size and scales the whole thing down with a
 * CSS transform so it fits the available width (ResizeObserver).
 */
export function DeviceFrame({ device, url, children, maxHeight, showScale = true, className, label, onReload }: DeviceFrameProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    setAvailable(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setAvailable(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vp = DEVICES[device];
  const chrome = FRAME_CHROME[device];
  const size = frameSize(device);
  const scale = computeScale(device, available, maxHeight);
  const pct = Math.round(scale * 100);

  return (
    <div className={cn('w-full min-w-0 max-w-full', className)} data-testid="preview-device" data-device={device}>
      {/* Measured wrapper: min-w-0 + overflow-hidden so the unscaled frame can never widen it. */}
      <div ref={outerRef} className="w-full min-w-0 max-w-full overflow-hidden">
        <div
          className="relative mx-auto"
          style={{ width: size.width * scale, height: size.height * scale }}
          role="group"
          aria-label={label ?? `${vp.label} preview, ${vp.width} by ${vp.height}`}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
            data-testid="device-frame-scaled"
          >
            {device === 'desktop' && (
              <DesktopChrome url={url} width={size.width} height={size.height} chromeTop={chrome.top} onReload={onReload}>
                {children}
              </DesktopChrome>
            )}
            {device === 'tablet' && (
              <div
                className="relative h-full w-full rounded-[44px] bg-neutral-900 shadow-[0_30px_80px_-20px_rgba(15,23,42,0.55)] ring-1 ring-black/40"
                style={{ padding: `${chrome.top}px ${chrome.x}px ${chrome.bottom}px` }}
              >
                <div className="absolute left-1/2 top-[8px] h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-neutral-700" aria-hidden />
                <Viewport width={vp.width} height={vp.height} className="rounded-[24px]">
                  {children}
                </Viewport>
              </div>
            )}
            {device === 'mobile' && (
              <div
                className="relative h-full w-full rounded-[62px] bg-neutral-900 shadow-[0_30px_80px_-20px_rgba(15,23,42,0.6)] ring-1 ring-black/40"
                style={{ padding: chrome.x }}
              >
                {/* side buttons */}
                <span className="absolute -left-[3px] top-[180px] h-[60px] w-[3px] rounded-l bg-neutral-800" aria-hidden />
                <span className="absolute -left-[3px] top-[260px] h-[60px] w-[3px] rounded-l bg-neutral-800" aria-hidden />
                <span className="absolute -right-[3px] top-[220px] h-[96px] w-[3px] rounded-r bg-neutral-800" aria-hidden />
                <Viewport width={vp.width} height={vp.height} className="rounded-[48px]">
                  {/* status bar + dynamic island overlay (does not shift the page) */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-[2147483000] flex h-[50px] items-center justify-between px-[34px] text-[15px] font-semibold text-white mix-blend-difference" aria-hidden>
                    <span>9:41</span>
                    <span className="flex items-center gap-[5px]">
                      <SignalIcon />
                      <BatteryIcon />
                    </span>
                  </div>
                  <div className="pointer-events-none absolute left-1/2 top-[11px] z-[2147483001] h-[34px] w-[122px] -translate-x-1/2 rounded-full bg-black" aria-hidden />
                  <div className="pointer-events-none absolute bottom-[8px] left-1/2 z-[2147483001] h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white mix-blend-difference" aria-hidden />
                  {children}
                </Viewport>
              </div>
            )}
          </div>
        </div>
      </div>
      {showScale && (
        <p className="mt-2 text-center text-xs text-slate-500" data-testid="device-scale-label">
          {vp.label} · {vp.width}×{vp.height} · {pct === 100 ? 'Actual size' : `Scaled to ${pct}%`}
        </p>
      )}
    </div>
  );
}

function Viewport({ width, height, className, children }: { width: number; height: number; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('relative overflow-hidden bg-white', className)}
      style={{ width, height }}
      data-testid="device-viewport"
    >
      {children}
    </div>
  );
}

function DesktopChrome({
  url,
  width,
  height,
  chromeTop,
  onReload,
  children,
}: {
  url?: string;
  width: number;
  height: number;
  chromeTop: number;
  onReload?: () => void;
  children: ReactNode;
}) {
  const host = hostnameOf(url);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_30px_80px_-20px_rgba(15,23,42,0.45)] ring-1 ring-black/10"
      style={{ width, height }}
    >
      <div className="flex shrink-0 items-center gap-4 border-b border-neutral-200 bg-neutral-100 px-5" style={{ height: chromeTop }}>
        <div className="flex gap-2" aria-hidden>
          <span className="h-3.5 w-3.5 rounded-full bg-[#ff5f57]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#febc2e]" />
          <span className="h-3.5 w-3.5 rounded-full bg-[#28c840]" />
        </div>
        {onReload ? (
          <button
            type="button"
            onClick={onReload}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
            aria-label="Reload page"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        ) : (
          <RotateCw className="h-4 w-4 text-neutral-400" aria-hidden />
        )}
        <div className="mx-auto flex h-7 w-[46%] min-w-0 items-center justify-center gap-2 rounded-lg bg-white px-4 text-[14px] text-neutral-600 ring-1 ring-neutral-200">
          <Lock className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
          <span className="truncate">{host || 'your-website.com'}</span>
        </div>
        <div className="w-[84px]" aria-hidden />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="device-viewport">
        {children}
      </div>
    </div>
  );
}

function SignalIcon() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden>
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor" />
      <path d="M25 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
