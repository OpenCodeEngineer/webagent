"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Bot, GitBranch, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      setError("Invalid email or password");
    } else {
      window.location.href = "/dashboard";
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center pb-2">
          <div className="flex items-center justify-center gap-2">
            <Bot className="h-7 w-7 text-primary" />
            <span className="text-2xl font-bold">Lamoom</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Sign in to manage your AI agents
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or continue with</span>
            <Separator className="flex-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
              className="w-full"
            >
              <Globe className="mr-2 h-4 w-4" />
              Google
            </Button>
            <Button
              variant="outline"
              onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
              className="w-full"
            >
              <GitBranch className="mr-2 h-4 w-4" />
              GitHub
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or use magic link</span>
            <Separator className="flex-1" />
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              setError("");
              const result = await signIn("email", { email: magicEmail, redirect: false });
              if (result?.error) {
                setError("Failed to send magic link");
              } else {
                setError("");
                setMagicSent(true);
              }
              setLoading(false);
            }}
            className="space-y-3"
          >
            {magicSent && (
              <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                Check your email for a sign-in link!
              </div>
            )}
            <div className="flex gap-2">
              <Input
                type="email"
                className="flex-1"
                value={magicEmail}
                onChange={(e) => setMagicEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
              <Button type="submit" variant="outline" disabled={loading || !magicEmail.trim()}>
                {loading ? "Sending…" : "Send link"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
