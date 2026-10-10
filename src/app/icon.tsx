import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Tab favicon — CloudCountry cloud mark. */
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
          background: "linear-gradient(135deg, #22d3ee 0%, #0ea5e9 100%)",
          borderRadius: 8,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M14 28c0-5.5 4-9.5 9.2-9.5 1.2-3.8 4.6-6.5 8.7-6.5 5.1 0 9.1 4 9.1 9.1 0 .4 0 .8-.1 1.2 3.1.7 5.4 3.5 5.4 6.8 0 3.9-3.1 7-7 7H16.5C11.9 36 8 32.1 8 27.5c0-3.8 2.6-7 6-7.9"
            fill="#041018"
            opacity="0.95"
          />
          <circle cx="24" cy="26" r="3.2" fill="#22d3ee" opacity="0.9" />
          <path
            d="M24 18.5v4.2M24 29.3v4.2M17.5 26h4.2M26.3 26h4.2"
            stroke="#22d3ee"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.85"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
