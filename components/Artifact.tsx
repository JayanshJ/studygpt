"use client";

import { useEffect, useRef, useState } from "react";

// Resize script injected into the artifact's HTML so the iframe reports its
// content height to the parent (which sets the iframe height). Runs on load
// and on a ResizeObserver so dynamically-rendered content (charts, async CDN
// libs that draw after fetch) eventually settles to the right height.
const RESIZE_SCRIPT = `<script>(function(){function s(){parent.postMessage({__artifactHeight:document.documentElement.scrollHeight||document.body.scrollHeight},"*");}if(document.readyState==="complete")s();else window.addEventListener("load",s);if(typeof ResizeObserver!=="undefined"){new ResizeObserver(s).observe(document.body);}})();<\/script>`;

// Inject the resize script just before </body> when the model emitted a full
// HTML document, else append it (handles HTML fragments too).
function withResizeScript(html: string): string {
  const i = html.lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + RESIZE_SCRIPT + html.slice(i) : html + RESIZE_SCRIPT;
}

// Renders a model-authored HTML visualization in a sandboxed iframe. The
// sandbox is `allow-scripts` WITHOUT `allow-same-origin`, so the artifact can
// run JS (and load CDN libs like Chart.js / Mermaid / Three.js) but cannot
// touch the parent page, cookies, or localStorage — making it safe to render
// arbitrary model output inline. The iframe height is driven by the content
// via postMessage (see RESIZE_SCRIPT); capped with internal scroll for very
// tall artifacts.
export function Artifact({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      // The iframe has a null origin (sandboxed), so don't check origin — only
      // honor messages whose source is THIS iframe's window.
      if (e.source !== ref.current?.contentWindow) return;
      const h = (e.data as { __artifactHeight?: number } | null)?.__artifactHeight;
      if (typeof h === "number" && h > 0) setHeight(Math.min(h, 1200));
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  }

  function openInTab() {
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  return (
    <div className="my-2 overflow-hidden rounded-[3px] border border-line bg-paper-2">
      <div className="mono flex items-center gap-2 border-b border-line bg-paper-3 px-3 py-1.5 text-[10px] tracking-wide text-ink-3">
        <span className="h-1 w-1 rounded-full bg-rule" />
        visualization · html
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={copyHtml} className="hover:text-ink">
            {copied ? "copied" : "copy"}
          </button>
          <button type="button" onClick={openInTab} className="hover:text-ink">
            open
          </button>
        </div>
      </div>
      <iframe
        ref={ref}
        title="visualization"
        sandbox="allow-scripts"
        srcDoc={withResizeScript(html)}
        scrolling="auto"
        style={{ height }}
        className="block w-full border-0 bg-paper-2"
      />
    </div>
  );
}