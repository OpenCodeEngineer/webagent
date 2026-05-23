"use client";

import { useState } from "react";
import { Copy, Check, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/toast";

interface Props {
  customerId: string | null;
  hmacSecret: string | null;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ message: `${label} copied to clipboard.`, type: "success" });
    } catch {
      toast({ message: "Failed to copy.", type: "error" });
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          <span className="sr-only">Copy {label}</span>
        </Button>
      </div>
    </div>
  );
}

export function SettingsEmbedApi({ customerId, hmacSecret }: Props) {
  if (!customerId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Embed API
          </CardTitle>
          <CardDescription>
            Use these credentials to authenticate direct API calls.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No credentials available.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-4 w-4" />
          Embed API
        </CardTitle>
        <CardDescription>
          Use these credentials to authenticate direct API calls to the Lamoom proxy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CopyField label="Customer ID" value={customerId} />
        {hmacSecret && <CopyField label="HMAC Secret" value={hmacSecret} />}
        <p className="text-xs text-muted-foreground">
          Sign requests with{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            HMAC-SHA256(secret, &ldquo;{"{"}customerId{"}"}&rdquo;)
          </code>{" "}
          and pass <code className="rounded bg-muted px-1 py-0.5">X-Customer-Id</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5">X-Customer-Sig</code> headers.
        </p>
      </CardContent>
    </Card>
  );
}
