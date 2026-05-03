import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

/**
 * Thin top progress bar that animates while the router is loading
 * or transitioning between routes. Provides instant feedback on click.
 */
export function TopProgressBar() {
  const router = useRouter();
  const status = useRouterState({ select: (s) => s.status });
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  // Listen for instant feedback: as soon as a navigation is intended,
  // show the bar — don't wait for loaders to complete.
  useEffect(() => {
    const unsub = router.subscribe("onBeforeNavigate", () => {
      setVisible(true);
      setProgress(15);
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    let raf: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    if (status === "pending") {
      setVisible(true);
      // Smooth crawl up to 90% while pending
      const tick = () => {
        setProgress((p) => (p < 90 ? p + (90 - p) * 0.08 : p));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else if (visible) {
      // Snap to 100, then fade out
      setProgress(100);
      timeout = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 250);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };
  }, [status, visible]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-0.5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 200ms ease" }}
    >
      <div
        className="h-full bg-gradient-primary shadow-glow"
        style={{
          width: `${progress}%`,
          transition: "width 180ms ease-out",
        }}
      />
    </div>
  );
}
