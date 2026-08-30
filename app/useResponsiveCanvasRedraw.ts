"use client";

import { useEffect, type RefObject } from "react";

/**
 * Redraw a canvas after responsive mobile layout settles, not only when React
 * data changes. Mobile browsers can update the visual viewport without
 * delivering a useful ResizeObserver entry for an offscreen chart.
 */
export function useResponsiveCanvasRedraw(
  target: RefObject<HTMLElement | null>,
  draw: () => void,
) {
  useEffect(() => {
    let frame: number | null = null;
    let settlingFrame: number | null = null;
    const settlingTimers: number[] = [];
    const redraw = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        draw();
        settlingFrame = requestAnimationFrame(() => {
          settlingFrame = null;
          draw();
        });
      });
    };

    draw();
    redraw();
    // iOS Safari can suspend animation frames for canvases below the fold.
    // Timers and visibility entry provide independent repaint paths once the
    // responsive shell has a measurable width.
    settlingTimers.push(window.setTimeout(draw, 100));
    settlingTimers.push(window.setTimeout(draw, 400));
    const observer = new ResizeObserver(redraw);
    if (target.current) observer.observe(target.current);
    const visibilityObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        draw();
        redraw();
      }
    });
    if (target.current) visibilityObserver.observe(target.current);
    const redrawAfterPageRestore = () => redraw();
    window.addEventListener("resize", redraw);
    window.addEventListener("orientationchange", redraw);
    window.addEventListener("pageshow", redrawAfterPageRestore);
    window.visualViewport?.addEventListener("resize", redraw);
    return () => {
      observer.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("resize", redraw);
      window.removeEventListener("orientationchange", redraw);
      window.removeEventListener("pageshow", redrawAfterPageRestore);
      window.visualViewport?.removeEventListener("resize", redraw);
      settlingTimers.forEach((timer) => window.clearTimeout(timer));
      if (frame !== null) cancelAnimationFrame(frame);
      if (settlingFrame !== null) cancelAnimationFrame(settlingFrame);
    };
  }, [draw, target]);
}
