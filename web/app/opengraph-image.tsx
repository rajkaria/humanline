import { ImageResponse } from "next/og";

export const alt = "Humanline — one human, one credit line";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The Humanline mark, inlined as a data URI.
 *
 * Satori (what `ImageResponse` renders with) does not read CSS custom
 * properties, so the brand gradient is written out as literal sRGB here — the
 * same two stops `--brand` / `--brand-2` resolve to in the dark theme.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="112" height="112">
  <defs>
    <linearGradient id="m" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9f90ff"/><stop offset="1" stop-color="#28d7dc"/>
    </linearGradient>
  </defs>
  <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="8" fill="url(#m)" opacity="0.16"/>
  <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="8" fill="none" stroke="url(#m)" stroke-width="1.5" opacity="0.5"/>
  <circle cx="9.5" cy="10" r="3" fill="url(#m)"/>
  <path d="M5 20.5c0-2.7 2-4.5 4.5-4.5s4.5 1.8 4.5 4.5" fill="none" stroke="url(#m)" stroke-width="2" stroke-linecap="round"/>
  <path d="M16.5 14h6.5" fill="none" stroke="url(#m)" stroke-width="2" stroke-linecap="round"/>
  <path d="M16.5 19h4" fill="none" stroke="url(#m)" stroke-width="2" stroke-linecap="round" opacity="0.55"/>
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
          padding: "72px 80px",
          background:
            "radial-gradient(900px 520px at 78% -10%, rgba(159,144,255,0.22), rgba(11,13,20,0) 60%), linear-gradient(160deg, #0b0d14 0%, #12141f 100%)",
          color: "#f4f5f8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <img src={markSrc} width={112} height={112} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>Humanline</div>
            <div style={{ fontSize: 22, color: "#a2a3b1" }}>Creditcoin CC3 · chainId 102031</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.05 }}>
            One human, one credit line.
          </div>
          <div style={{ fontSize: 30, color: "#a2a3b1", maxWidth: 900, lineHeight: 1.35 }}>
            World ID proof of personhood, carried to Creditcoin by the Attestcoin Protocol. No
            bridge, no oracle operator, no second wallet.
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
