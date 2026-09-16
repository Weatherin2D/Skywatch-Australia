import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
  inverted?: boolean;
};

export function SkyWatchLogo({
  className,
  markClassName,
  showWordmark = true,
  size = "md",
  inverted = false,
}: LogoProps) {
  const markSize =
    size === "lg" ? "h-10 w-10" : size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const textSize =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-sm bg-[var(--bom-yellow)] text-[var(--brand)]",
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
          <path
            d="M23 18l2.2 7.2H19l8 10-2.4-7.6H31L23 18z"
            fill="#003087"
          />
        </svg>
      </span>
      {showWordmark ? (
        <span
          className={cn(
            "font-[family-name:var(--font-display)] font-bold tracking-tight",
            inverted ? "text-[var(--brand)]" : "text-white",
            textSize,
          )}
        >
          SkyWatch Australia
        </span>
      ) : null}
    </div>
  );
}
