"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      void navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Pull the nav-fix SW immediately so clients aren't stuck on an
          // older worker that cached HTML documents.
          void reg.update();
        })
        .catch(() => {
          /* ignore registration failures in dev */
        });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
