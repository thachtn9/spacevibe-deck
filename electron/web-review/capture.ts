import type { ReviewCapture, ReviewRect } from "../../src/lib/web-review";
import { reviewText } from "./storage";

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid page evidence.");
  return v as Record<string, unknown>;
};
const numeric = (v: unknown, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error("Invalid selection geometry.");
  return v;
};
const record = (v: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(object(v))
      .slice(0, 24)
      .map(([k, value]) => [reviewText(k, 100), reviewText(value, 500)]),
  );
const texts = (v: unknown, max: number): string[] => {
  if (!Array.isArray(v) || v.length > max) throw new Error("Too much page context.");
  return v.map((item) => reviewText(item, 200));
};

export function validateReviewCapture(raw: unknown, currentUrl: string): ReviewCapture {
  const v = object(raw),
    viewport = object(v.viewport),
    box = object(v.rect);
  const url = reviewText(v.url, 2048);
  if (url !== currentUrl || (v.kind !== "element" && v.kind !== "region"))
    throw new Error("The page changed. Select the element again.");
  const width = numeric(viewport.width, 1, 16000),
    height = numeric(viewport.height, 1, 16000);
  const rect: ReviewRect = {
    x: numeric(box.x, 0, width),
    y: numeric(box.y, 0, height),
    width: numeric(box.width, 1, width),
    height: numeric(box.height, 1, height),
  };
  if (rect.x + rect.width > width + 2 || rect.y + rect.height > height + 2)
    throw new Error("Selection is outside the page.");
  return {
    kind: v.kind,
    url,
    title: reviewText(v.title, 500),
    capturedAt: Date.now(),
    rect,
    viewport: {
      width,
      height,
      scale: numeric(viewport.scale, 0.25, 8),
      scrollX: numeric(viewport.scrollX, -1e7, 1e7),
      scrollY: numeric(viewport.scrollY, -1e7, 1e7),
    },
    selector: reviewText(v.selector, 2000),
    tag: reviewText(v.tag, 100),
    text: reviewText(v.text, 1500),
    label: reviewText(v.label, 160),
    role: reviewText(v.role, 100),
    attributes: record(v.attributes),
    styles: record(v.styles),
    components: texts(v.components, 12),
    source: v.source === null ? null : reviewText(v.source, 1000),
    headings: texts(v.headings, 8),
    dialog: reviewText(v.dialog, 300),
    selectedTab: reviewText(v.selectedTab, 200),
  };
}
