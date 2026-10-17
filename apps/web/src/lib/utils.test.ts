import { describe, expect, it } from 'vitest';
import { normalizeUrl, safeHref } from './utils';

describe('safeHref', () => {
  it('allows only absolute http(s) URLs', () => {
    expect(safeHref('https://acme.example/pricing')).toBe('https://acme.example/pricing');
    expect(safeHref('http://acme.example')).toBe('http://acme.example/');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref(' JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox')).toBeUndefined();
    expect(safeHref('/relative')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe('normalizeUrl', () => {
  it('adds https and rejects junk', () => {
    expect(normalizeUrl('acme.example')).toBe('https://acme.example/');
    expect(normalizeUrl('nope')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});
