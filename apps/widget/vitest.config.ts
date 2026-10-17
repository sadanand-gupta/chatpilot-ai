import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
    __DEFAULT_API_URL__: JSON.stringify('http://api.test'),
    __PRODUCT_NAME__: JSON.stringify('ChatPilot AI'),
    __PRODUCT_URL__: JSON.stringify('http://app.test'),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
