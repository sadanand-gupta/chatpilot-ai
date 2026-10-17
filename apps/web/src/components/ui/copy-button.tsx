import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { Button, type ButtonProps } from './button';

export interface CopyButtonProps extends Omit<ButtonProps, 'value' | 'onClick'> {
  value: string;
  label?: string;
  copiedLabel?: string;
}

export function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied', variant = 'outline', size = 'sm', ...props }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Button
      variant={variant}
      size={size}
      aria-label={copied ? copiedLabel : label}
      onClick={async () => {
        const ok = await copyToClipboard(value);
        if (ok) setCopied(true);
        else toast.error('Could not copy — please select and copy manually.');
      }}
      {...props}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
      {size !== 'icon' && <span>{copied ? copiedLabel : label}</span>}
    </Button>
  );
}
