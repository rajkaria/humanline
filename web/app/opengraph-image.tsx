import { ImageResponse } from "next/og";

export const alt = "Humanline: one human, one credit line";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The Humanline mark, inlined as a data URI.
 *
 * Satori (what `ImageResponse` renders with) does not read CSS custom
 * properties, so the brand gradient is written out as literal sRGB here — the
 * same two stops `--brand` / `--brand-2` resolve to in the dark theme.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="116" height="116">
  <defs>
    <linearGradient id="m" x1="3" y1="8" x2="29" y2="24" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9f90ff"/><stop offset="0.45" stop-color="#7fa6f4"/><stop offset="1" stop-color="#28d7dc"/>
    </linearGradient>
  </defs>
  <path d="M19.91 10.21 A 9.4 9.4 0 1 0 19.91 21.79" fill="none" stroke="url(#m)" stroke-width="1.7" stroke-linecap="round" opacity="0.34"/>
  <path d="M18.15 13 A 6.4 6.4 0 1 0 18.15 19" fill="none" stroke="url(#m)" stroke-width="2.1" stroke-linecap="round" opacity="0.66"/>
  <circle cx="12.5" cy="16" r="3.5" fill="url(#m)"/>
  <path d="M15.6 16 H 28.4" fill="none" stroke="url(#m)" stroke-width="3.1" stroke-linecap="round"/>
</svg>`;

const markSrc = `data:image/svg+xml;base64,${Buffer.from(MARK).toString("base64")}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 76px",
          background:
            "radial-gradient(900px 520px at 78% -10%, rgba(159,144,255,0.22), rgba(11,13,20,0) 60%), linear-gradient(160deg, #0b0d14 0%, #12141f 100%)",
          color: "#f4f5f8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <img src={markSrc} width={116} height={116} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>Humanline</div>
            <div style={{ fontSize: 22, color: "#a2a3b1" }}>Creditcoin CC3 · chainId 102031</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 74, fontWeight: 700, letterSpacing: -2.2, lineHeight: 1.06 }}>
            One human, one credit line.
          </div>
          <div style={{ fontSize: 27, color: "#a2a3b1", maxWidth: 880, lineHeight: 1.4 }}>
            Prove you&rsquo;re a person once with World ID. Attestcoin carries it to Creditcoin.
            No bridge, no oracle operator, no second wallet.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 24 }}>
          {["World ID", "Attestcoin", "Creditcoin"].map((step, i) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 18 }}>
              {i > 0 ? <div style={{ color: "#5b5d70" }}>→</div> : null}
              <div
                style={{
                  display: "flex",
                  padding: "10px 20px",
                  borderRadius: 999,
                  border: "1px solid rgba(159,144,255,0.35)",
                  background: "rgba(159,144,255,0.10)",
                  color: "#cfc8ff",
                }}
              >
                {step}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
