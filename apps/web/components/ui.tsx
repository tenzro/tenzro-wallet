'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@tenzro/ui';
import { useCallback, useState } from 'react';

export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card variant="raised" className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-foreground-muted">{hint}</span> : null}
    </label>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
}) {
  const tones = {
    info: 'border-border-default bg-surface-2 text-foreground',
    warning: 'border-warning/30 bg-warning-soft text-foreground',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    success: 'border-success/30 bg-success-soft text-foreground',
  } as const;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl border px-4 py-3 text-sm', tones[tone])}
    >
      {children}
    </div>
  );
}

/** A code the person moves to another device or person: copy or save it. */
export function CodeBox({ code, fileName }: { code: string; fileName?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <textarea
        readOnly
        value={code}
        rows={4}
        className="w-full resize-none rounded-xl border border-border-default bg-surface-2 p-3 font-mono text-xs text-foreground break-all"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(code).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {fileName ? (
          <Button size="sm" variant="ghost" onClick={() => download(fileName, code)}>
            Save as file
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

/** Runs an action with a pending flag and a readable error. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(readable(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, setError, run };
}

export function readable(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'The passkey prompt was closed.';
  }
  return e instanceof Error ? e.message : String(e);
}
