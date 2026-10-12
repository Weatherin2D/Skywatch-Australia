import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
  inverted?: boolean;
};

export function CloudCountryLogo({
  className,
  markClassName,
  showWordmark = true,
  size = "md",
  inverted = false,
}: LogoProps) {
  const markSize =
    size === "lg" ? "h-11 w-11" : size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const textSize =
    size === "lg" ? "text-[1.75rem]" : size === "sm" ? "text-base" : "text-[1.35rem]";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--cyan)] to-[#0ea5e9] text-[#041018] shadow-[0_0_24px_rgba(34,211,238,0.35)]",
          markSize,
          markClassName,
        )}
        aria-hidden
      >
        <svg viewBox="0 0 48 48" className="h-[70%] w-[70%]" fill="none">
          <path
            d="M14 28c0-5.5 4-9.5 9.2-9.5 1.2-3.8 4.6-6.5 8.7-6.5 5.1 0 9.1 4 9.1 9.1 0 .4 0 .8-.1 1.2 3.1.7 5.4 3.5 5.4 6.8 0 3.9-3.1 7-7 7H16.5C11.9 36 8 32.1 8 27.5c0-3.8 2.6-7 6-7.9"
            fill="currentColor"
            opacity="0.95"
          />
          <circle cx="24" cy="26" r="3.2" fill="#041018" opacity="0.85" />
          <path
            d="M24 18.5v4.2M24 29.3v4.2M17.5 26h4.2M26.3 26h4.2"
            stroke="#041018"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>
      </span>
      {showWordmark ? (
        <span
          className={cn(
            "font-[family-name:var(--font-display)] font-semibold uppercase leading-none tracking-[0.02em]",
            textSize,
          )}
        >
          <span className={inverted ? "text-[var(--brand)]" : "text-white"}>
            Thunderstate
          </span>
          <span className="text-[var(--cyan)]"> Australia</span>
        </span>
      ) : null}
    </div>
  );
}
