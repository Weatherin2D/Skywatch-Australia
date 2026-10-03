/** Capture + store a single national archive satellite frame. */

import sharp from "sharp";
import {
  ensureArchiveMeta,
  getSatFrame,
  putSatFrame,
  satFrameExists,
} from "@/lib/weather/archive-storage";
import { quantizeArchiveStamp } from "@/lib/weather/archive-time";
import { fetchAndCacheFrameResilient } from "@/lib/weather/fetch-frame";
import {
  GIBS_AU_BOUNDS,
  type SatelliteProductId,
} from "@/lib/weather/maps";

const JPEG_QUALITY = 72;

const inflight = new Map<
  string,
  Promise<{ body: Buffer; captured: boolean } | null>
>();

async function toJpeg(body: Buffer): Promise<Buffer> {
  return sharp(body).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

/**
 * Return archived JPEG bytes, capturing from upstream when missing and the
 * stamp is inside [epoch, now]. Dedupes concurrent captures of the same stamp.
 */
export async function ensureArchiveSatFrame(
  product: SatelliteProductId,
  timeUnix: number,
): Promise<{ body: Buffer; captured: boolean } | null> {
  const stamp = quantizeArchiveStamp(timeUnix);
  const key = `${product}:${stamp}`;

  const existing = await getSatFrame(product, stamp);
  if (existing) return { body: existing, captured: false };

  const pending = inflight.get(key);
  if (pending) return pending;

  const work = (async () => {
    try {
      const meta = await ensureArchiveMeta();
      const now = Math.floor(Date.now() / 1000);
      if (stamp < meta.epochUnix || stamp > now + 180) return null;

      if (await satFrameExists(product, stamp)) {
        const again = await getSatFrame(product, stamp);
        if (again) return { body: again, captured: false };
      }

      const got = await fetchAndCacheFrameResilient(
        product,
        stamp,
        GIBS_AU_BOUNDS,
        "national",
      );
      if (!got) return null;
      const jpeg = await toJpeg(got.body);
      try {
        await putSatFrame(product, stamp, jpeg);
      } catch (err) {
        console.warn(`[archive-sat] persist failed ${key}`, err);
      }
      return { body: jpeg, captured: true };
    } catch (err) {
      console.error(`[archive-sat] ${key}`, err);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, work);
  return work;
}
