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
    const observer = new ResizeObserver(redraw);
    if (target.current) observer.observe(target.current);
    window.addEventListener("resize", redraw);
    window.addEventListener("orientationchange", redraw);
    window.visualViewport?.addEventListener("resize", redraw);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", redraw);
      window.removeEventListener("orientationchange", redraw);
      window.visualViewport?.removeEventListener("resize", redraw);
      if (frame !== null) cancelAnimationFrame(frame);
      if (settlingFrame !== null) cancelAnimationFrame(settlingFrame);
    };
  }, [draw, target]);
}
