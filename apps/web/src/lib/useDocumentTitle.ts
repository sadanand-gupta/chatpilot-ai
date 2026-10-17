import { useEffect } from 'react';
import { appConfig } from './config';

/** Sets `document.title` to "<title> — <productName>" (or just the product name). */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${appConfig.productName}` : appConfig.productName;
  }, [title]);
}
