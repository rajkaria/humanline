"use client";

/**
 * The last resort: an error thrown in the root layout itself.
 *
 * It replaces `<html>`, so it cannot use the site chrome or the theme provider —
 * hence the inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#16161f",
          color: "#f2f2f5",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Humanline failed to start</h1>
          <p style={{ margin: 0, fontSize: 14, color: "#a8a8b6", lineHeight: 1.6 }}>
            Something went wrong before the page could render. Everything Humanline claims is
            still checkable from a terminal. The commands are on /judge.
          </p>
          <code style={{ fontSize: 12, color: "#a8a8b6", wordBreak: "break-word" }}>
            {error.message}
            {error.digest ? ` · digest ${error.digest}` : ""}
          </code>
          <button
            type="button"
            onClick={reset}
            style={{
              alignSelf: "flex-start",
              marginTop: 8,
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #3a3a4a",
              background: "#22222d",
              color: "#f2f2f5",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
