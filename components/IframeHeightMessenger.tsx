"use client";

import { useEffect } from "react";

const PARENT_ORIGIN = "https://pos.uniq.web.id";

function updateHeight() {
  if (typeof window === "undefined") {
    return;
  }

  window.parent.postMessage(
    {
      type: "iframe-height",
      height: document.documentElement.scrollHeight,
    },
    PARENT_ORIGIN,
  );
}

export function IframeHeightMessenger() {
  useEffect(() => {
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(document.body);

    window.addEventListener("load", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", updateHeight);
    };
  }, []);

  return null;
}
