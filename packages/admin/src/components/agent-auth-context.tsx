"use client";

import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { serverUpdateAgent } from "@/lib/actions";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type AuthScheme = "Bearer" | "Token" | "ApiKey" | "Basic" | "Custom";

const AUTH_SCHEMES: AuthScheme[] = ["Bearer", "Token", "ApiKey", "Basic", "Custom"];

interface CustomHeader {
  key: string;
  value: string;
}

interface AgentAuthContextProps {
  agentId: string;
  initialApiToken?: string;
  initialHeaderName?: string;
  initialScheme?: AuthScheme;
  initialCustomHeaders?: CustomHeader[];
}

export function AgentAuthContext({
  agentId,
  initialApiToken,
  initialHeaderName,
  initialScheme,
  initialCustomHeaders,
}: AgentAuthContextProps) {
  const [apiToken, setApiToken] = useState(initialApiToken || "");
  const [headerName, setHeaderName] = useState(initialHeaderName || "Authorization");
  const [scheme, setScheme] = useState<AuthScheme>(initialScheme || "Bearer");
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>(
    initialCustomHeaders || []
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const addCustomHeader = () => {
    setCustomHeaders([...customHeaders, { key: "", value: "" }]);
  };

  const removeCustomHeader = (index: number) => {
    setCustomHeaders(customHeaders.filter((_, i) => i !== index));
  };

  const updateCustomHeader = (index: number, field: "key" | "value", value: string) => {
    const updated = [...customHeaders];
    updated[index] = { ...updated[index]!, [field]: value };
    setCustomHeaders(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Build headers map from custom headers
      const headers: Record<string, string> = {};
      for (const h of customHeaders) {
        if (h.key.trim()) {
          headers[h.key.trim()] = h.value;
        }
      }

      // Build the primary Authorization value using scheme + token
      let authorizationValue: string | undefined;
      if (apiToken) {
        if (scheme === "Custom") {
          authorizationValue = apiToken;
        } else {
          authorizationValue = `${scheme} ${apiToken}`;
        }
      }

      // If header name is not Authorization, put it in custom headers instead
      if (apiToken && headerName.trim() && headerName.trim() !== "Authorization") {
        headers[headerName.trim()] = authorizationValue!;
        authorizationValue = undefined;
      }

      await serverUpdateAgent(agentId, {
        widgetConfig: {
          authContext: {
            apiToken: apiToken || undefined,
            headerName: headerName || "Authorization",
            scheme,
            Authorization: authorizationValue,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
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
      <CardContent className="space-y-6">
        {/* Primary token */}
        <div className="space-y-2">
          <Label htmlFor="apiToken">API Token</Label>
          <Input
            id="apiToken"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="Enter API token (optional)"
          />
        </div>

        {/* Header name + scheme row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="headerName">Header Name</Label>
            <Input
              id="headerName"
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
              placeholder="Authorization"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheme">Scheme</Label>
            <select
              id="scheme"
              value={scheme}
              onChange={(e) => setScheme(e.target.value as AuthScheme)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {AUTH_SCHEMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Custom headers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Custom Headers</Label>
            <Button type="button" variant="outline" size="sm" onClick={addCustomHeader}>
              <Plus className="mr-1 h-3 w-3" />
              Add Header
            </Button>
          </div>
          {customHeaders.length > 0 && (
            <div className="space-y-2">
              {customHeaders.map((header, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={header.key}
                    onChange={(e) => updateCustomHeader(index, "key", e.target.value)}
                    placeholder="Header name"
                    className="flex-1"
                  />
                  <Input
                    value={header.value}
                    onChange={(e) => updateCustomHeader(index, "value", e.target.value)}
                    placeholder="Header value"
                    type="password"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeCustomHeader(index)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {customHeaders.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No custom headers configured. Add headers for additional auth requirements.
            </p>
          )}
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving\u2026" : "Save Configuration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
