import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon — larger radar mark for home screen. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1224",
          borderRadius: 36,
        }}
      >
        <svg
          width="140"
          height="140"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="16"
            cy="16"
            r="11"
            stroke="#22d3ee"
            strokeWidth="2"
            opacity="0.35"
          />
          <circle
            cx="16"
            cy="16"
            r="7"
            stroke="#22d3ee"
            strokeWidth="1.8"
            opacity="0.7"
          />
          <path
            d="M16 16 L16 5 A11 11 0 0 1 25.5 20.5 Z"
            fill="#22d3ee"
            opacity="0.95"
          />
          <circle cx="16" cy="16" r="2.4" fill="#22d3ee" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
