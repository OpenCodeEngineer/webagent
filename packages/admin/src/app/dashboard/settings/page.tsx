"use client";

import { useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  updateDisplayName,
  changePassword,
  getEmbedApiCredentials,
  getOrCreateApiToken,
  rotateApiToken,
  getAccountProviders,
  deleteAccount,
} from "@/lib/settings-actions";
import { useEffect } from "react";

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}

// ── Account section ───────────────────────────────────────────────────────────

function AccountSection() {
  const { data: session, update } = useSession();
  const [name, setName] = useState(session?.user?.name ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
  }, [session?.user?.name]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("name", name);
    startTransition(async () => {
      const res = await updateDisplayName(fd);
      if (res.error) {
        setMsg(res.error);
      } else {
        await update();
        setMsg("Name updated.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Your profile information.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={session?.user?.email ?? ""} disabled />
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Security section ──────────────────────────────────────────────────────────

function SecuritySection() {
  const [hasCredentials, setHasCredentials] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    getAccountProviders().then((r) => setHasCredentials(r.hasCredentials));
  }, []);

  if (!hasCredentials) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("currentPassword", form.currentPassword);
    fd.set("newPassword", form.newPassword);
    fd.set("confirmPassword", form.confirmPassword);
    startTransition(async () => {
      const res = await changePassword(fd);
      if (res.error) {
        setIsError(true);
        setMsg(res.error);
      } else {
        setIsError(false);
        setMsg("Password changed.");
        setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Change your password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div className="space-y-1">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              value={form.currentPassword}
              onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              value={form.newPassword}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            />
          </div>
          {msg && (
            <p className={`text-sm ${isError ? "text-destructive" : "text-muted-foreground"}`}>
              {msg}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Changing…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Embed API section ─────────────────────────────────────────────────────────

function EmbedApiSection() {
  const [creds, setCreds] = useState<{ customerId: string | null; hmacSecret: string | null; hasCredentials: boolean } | null>(null);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    getEmbedApiCredentials().then(setCreds);
    getOrCreateApiToken().then((r) => setApiToken(r.apiToken));
  }, []);

  const handleRotate = async () => {
    if (!window.confirm("Rotate API token? The old token will stop working immediately.")) return;
    setRotating(true);
    try {
      const r = await rotateApiToken();
      setApiToken(r.apiToken);
    } finally {
      setRotating(false);
    }
  };

  if (!creds?.hasCredentials) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Embed API</CardTitle>
        <CardDescription>
          Use these credentials to authenticate direct API calls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="space-y-1">
          <Label>Customer ID</Label>
          <div className="flex items-center gap-2">
            <Input value={creds.customerId ?? ""} readOnly className="font-mono text-xs" />
            <CopyButton value={creds.customerId ?? ""} />
          </div>
        </div>
        <div className="space-y-1">
          <Label>HMAC Secret</Label>
          <div className="flex items-center gap-2">
            <Input value={creds.hmacSecret ?? ""} readOnly type="password" className="font-mono text-xs" />
            <CopyButton value={creds.hmacSecret ?? ""} />
          </div>
        </div>
        {apiToken !== null && (
          <div className="space-y-1">
            <Label>API Token</Label>
            <div className="flex items-center gap-2">
              <Input value={apiToken} readOnly type="password" className="font-mono text-xs" />
              <CopyButton value={apiToken} />
              <Button variant="outline" size="sm" onClick={handleRotate} disabled={rotating}>
                {rotating ? "Rotating…" : "Rotate"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────────

function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteAccount();
      window.location.href = "/login";
    });
  }

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent>
        {!confirming ? (
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              This permanently deletes your account and all agents. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" disabled={pending} onClick={handleDelete}>
                {pending ? "Deleting…" : "Yes, delete my account"}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <AccountSection />
      <SecuritySection />
      <Separator />
      <EmbedApiSection />
      <Separator />
      <DangerZone />
    </div>
  );
}
