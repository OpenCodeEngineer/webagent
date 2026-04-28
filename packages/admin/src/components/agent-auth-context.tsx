"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { serverUpdateAgent } from "@/lib/actions";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AgentAuthContextProps {
  agentId: string;
  initialApiToken?: string;
}

export function AgentAuthContext({ agentId, initialApiToken }: AgentAuthContextProps) {
  const [apiToken, setApiToken] = useState(initialApiToken || "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    setSaving(true);
    try {
      await serverUpdateAgent(agentId, {
        widgetConfig: {
          authContext: {
            apiToken: apiToken || undefined,
          },
        },
      });
      toast({ message: "API configuration saved.", type: "success" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Failed to save.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          API Configuration
        </CardTitle>
        <CardDescription>
          Configure credentials for API calls. These are stored securely on the server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="apiToken" className="text-sm font-medium">
              API Token
            </label>
            <Input
              id="apiToken"
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="Enter API token (optional)"
              className="mt-1"
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}