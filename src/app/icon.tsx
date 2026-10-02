import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Tab favicon — cyan radar mark on navy. */
export default function Icon() {
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
          borderRadius: 8,
        }}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="16"
            cy="16"
            r="11"
            stroke="#22d3ee"
            strokeWidth="2.2"
            opacity="0.35"
          />
          <circle
            cx="16"
            cy="16"
            r="7"
            stroke="#22d3ee"
            strokeWidth="2"
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
