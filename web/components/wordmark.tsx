import { cn } from "@/lib/utils";

/** The one gradient id every instance of the mark points at. */
const GRADIENT_ID = "hl-mark-gradient";

/**
 * Defines the brand gradient once per document.
 *
 * The mark is drawn in several places (header, footer, hero, icons). Repeating
 * a `<defs>` block in each one would repeat the element id too, so the gradient
 * lives in a single zero-size SVG rendered by the root layout and every mark
 * references it by url(). Zero-size rather than `display: none` — a hidden
 * subtree does not reliably resolve paint-server references.
 */
export function BrandGradientDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden
      focusable="false"
      style={{ position: "absolute", overflow: "hidden" }}
    >
      <defs>
        <linearGradient id={GRADIENT_ID} x1="3" y1="8" x2="29" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="0.45" stopColor="color-mix(in oklab, var(--brand) 60%, var(--brand-2))" />
          <stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * The Humanline mark: a human at the centre of two proof rings, with one credit
 * line leaving through the gap the rings open for it. One person, one line —
 * the rings are the zero-knowledge proof that the person is real and singular.
 *
 * Inline SVG so it inherits the theme, scales crisply and costs no request.
 */
export function Mark({ className }: { className?: string }) {
  const paint = `url(#${GRADIENT_ID})`;
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7 shrink-0", className)}
      role="img"
      aria-label="Humanline"
      focusable="false"
    >
      <path
        d="M19.91 10.21 A 9.4 9.4 0 1 0 19.91 21.79"
        fill="none"
        stroke={paint}
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.34"
      />
      <path
        d="M18.15 13 A 6.4 6.4 0 1 0 18.15 19"
        fill="none"
        stroke={paint}
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.66"
      />
      <circle cx="12.5" cy="16" r="3.5" fill={paint} />
      <path
        d="M15.6 16 H 28.4"
        fill="none"
        stroke={paint}
        strokeWidth="3.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mark plus name, the lockup used in the header and footer. */
export function Wordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Mark className={cn("size-6", markClassName)} />
      <span className="font-heading text-[15px] font-semibold tracking-[-0.02em]">
        Humanline
      </span>
    </span>
  );
}
