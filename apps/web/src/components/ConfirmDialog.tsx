import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** When set, the user must type this text to enable the confirm button. */
  confirmText?: string;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = true,
  loading = false,
  confirmText,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const blocked = Boolean(confirmText) && typed.trim() !== confirmText;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        if (!loading) onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {confirmText && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-text">
              Type <span className="font-mono font-semibold text-red-600">{confirmText}</span> to confirm
            </Label>
            <Input id="confirm-text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={blocked || loading} onClick={() => void onConfirm()}>
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
