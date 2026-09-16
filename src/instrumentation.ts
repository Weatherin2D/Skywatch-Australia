export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureLightningFeed } = await import(
      "@/lib/weather/blitzortung-feed"
    );
    ensureLightningFeed();
  }
}
