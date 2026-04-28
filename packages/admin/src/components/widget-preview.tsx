"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_WIDGET_HOST = "https://dev.lamoom.com";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function WidgetPreview({ agentToken, widgetBaseUrl }: { agentToken: string; widgetBaseUrl?: string }) {
  const [runtimeOrigin, setRuntimeOrigin] = useState<string | null>(null);

  useEffect(() => {
    setRuntimeOrigin(window.location.origin);
  }, []);

  const widgetHost = widgetBaseUrl ?? runtimeOrigin ?? DEFAULT_WIDGET_HOST;
  const scriptSrc = `${widgetHost.replace(/\/+$/, "")}/widget.js`;
  const safeToken = escapeAttr(agentToken);
  const safeScriptSrc = escapeAttr(scriptSrc);

  const srcDoc = useMemo(
    () => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;background:#111;">
    <script src="${safeScriptSrc}" data-agent-token="${safeToken}" async></script>
  </body>
</html>`,
    [safeScriptSrc, safeToken],
  );

  return (
    <div>
      <iframe
        title="Real widget preview"
        srcDoc={srcDoc}
        className="w-full rounded-xl border border-zinc-700 bg-black"
        style={{ height: 540 }}
      />
    </div>
  );
}
