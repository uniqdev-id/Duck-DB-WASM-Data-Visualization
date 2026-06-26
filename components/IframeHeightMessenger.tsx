"use client";

import { useEffect } from "react";

const PARENT_ORIGIN = "*";

export function IframeHeightMessenger() {
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      window.parent.postMessage(
        {
          type: "iframe-height",
          height: document.documentElement.scrollHeight,
        },
        PARENT_ORIGIN,
      );
    });

    resizeObserver.observe(document.body);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return null;
}
