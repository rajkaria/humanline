import { cn } from "@/lib/utils";

/**
 * The Humanline mark: a person-dot whose "line" of credit extends to the right.
 * Inline SVG so it inherits colour, scales crisply and adds no network request.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 28 28"
        className="size-6 shrink-0"
        role="img"
        aria-label="Humanline"
      >
        <defs>
          <linearGradient id="hl-mark" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--brand)" />
            <stop offset="1" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="8" fill="url(#hl-mark)" opacity="0.16" />
        <rect
          x="0.75"
          y="0.75"
          width="26.5"
          height="26.5"
          rx="8"
          fill="none"
          stroke="url(#hl-mark)"
          strokeWidth="1.5"
          opacity="0.5"
        />
        <circle cx="9.5" cy="10" r="3" fill="url(#hl-mark)" />
        <path
          d="M5 20.5c0-2.7 2-4.5 4.5-4.5s4.5 1.8 4.5 4.5"
          fill="none"
          stroke="url(#hl-mark)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M16.5 14h6.5"
          fill="none"
          stroke="url(#hl-mark)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M16.5 19h4"
          fill="none"
          stroke="url(#hl-mark)"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Humanline</span>
    </span>
  );
}
