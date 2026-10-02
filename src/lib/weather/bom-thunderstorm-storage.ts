import { promises as fs } from "fs";
import path from "path";
import { del, list, put } from "@vercel/blob";
import { useBlobStorage } from "@/lib/forecast/storage";
import {
  emptyBomRiskManifest,
  type BomRiskDayRecord,
  type BomRiskDisplay,
  type BomRiskManifest,
  type BomThunderstormDay,
} from "@/lib/weather/bom-thunderstorm";
import type { MapRegionId } from "@/components/home/mock-data";

const DATA_DIR = path.join(process.cwd(), "data", "bom-risk");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");
const TMP_DIR = "/tmp/skywatch-bom-risk";
const TMP_MANIFEST = path.join(TMP_DIR, "manifest.json");
const BLOB_PREFIX = "skywatch/bom-risk/";

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function imageFileName(day: BomThunderstormDay, ext: string) {
  return `day-${day}.${ext}`;
}

function extFromContentType(ct: string | null | undefined, fileName?: string) {
  if (fileName) {
    const m = fileName.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/);
    if (m) return m[1] === "jpeg" ? "jpg" : m[1]!;
  }
  if (!ct) return "png";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "png";
}

async function readManifestFile(filePath: string): Promise<BomRiskManifest | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as BomRiskManifest;
    if (!parsed?.days?.["1"] || !parsed?.days?.["2"] || !parsed?.days?.["3"]) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeManifestFile(filePath: string, manifest: BomRiskManifest) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), "utf8");
}

async function readBlobManifest(): Promise<BomRiskManifest | null> {
  if (!useBlobStorage()) return null;
  try {
    const { blobs } = await list({ prefix: `${BLOB_PREFIX}manifest`, limit: 20 });
    const hit = blobs
      .filter((b) => b.pathname.endsWith("manifest.json"))
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))[0];
    if (!hit) return null;
    const res = await fetch(hit.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as BomRiskManifest;
  } catch {
    return null;
  }
}

export async function readBomRiskManifest(): Promise<BomRiskManifest> {
  const local = await readManifestFile(MANIFEST_PATH);
  if (local) return local;
  const tmp = await readManifestFile(TMP_MANIFEST);
  if (tmp) return tmp;
  const blob = await readBlobManifest();
  if (blob) return blob;
  return emptyBomRiskManifest();
}

async function persistManifest(manifest: BomRiskManifest) {
  await writeManifestFile(MANIFEST_PATH, manifest);
  try {
    await writeManifestFile(TMP_MANIFEST, manifest);
  } catch {
    /* ignore tmp failures */
  }
  if (useBlobStorage()) {
    await put(`${BLOB_PREFIX}manifest.json`, JSON.stringify(manifest), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }
}

export async function readBomRiskImage(
  day: BomThunderstormDay,
): Promise<{ body: Buffer; contentType: string } | null> {
  const manifest = await readBomRiskManifest();
  const rec = manifest.days[String(day) as "1" | "2" | "3"];
  if (!rec?.imagePath) return null;

  // Local / tmp path
  if (rec.imagePath.startsWith("local:")) {
    const rel = rec.imagePath.slice("local:".length);
    for (const root of [DATA_DIR, TMP_DIR]) {
      try {
        const body = await fs.readFile(path.join(root, rel));
        return { body, contentType: rec.contentType || "image/png" };
      } catch {
        /* try next */
      }
    }
    return null;
  }

  // Seeded public asset
  if (rec.imagePath.startsWith("public:")) {
    const rel = rec.imagePath.slice("public:".length);
    try {
      const body = await fs.readFile(path.join(process.cwd(), "public", rel));
      return { body, contentType: rec.contentType || "image/jpeg" };
    } catch {
      return null;
    }
  }

  // Remote blob URL
  if (rec.imagePath.startsWith("http://") || rec.imagePath.startsWith("https://")) {
    try {
      const res = await fetch(rec.imagePath, { cache: "no-store" });
      if (!res.ok) return null;
      const body = Buffer.from(await res.arrayBuffer());
      return {
        body,
        contentType: res.headers.get("content-type") || rec.contentType || "image/png",
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function saveBomRiskImage(opts: {
  day: BomThunderstormDay;
  buffer: Buffer;
  contentType: string;
  fileName: string;
  regionId: MapRegionId;
  display: BomRiskDisplay;
  issuedAt?: string | null;
}): Promise<BomRiskDayRecord> {
  const ext = extFromContentType(opts.contentType, opts.fileName);
  const file = imageFileName(opts.day, ext);
  await ensureDir(DATA_DIR);
  await fs.writeFile(path.join(DATA_DIR, file), opts.buffer);
  try {
    await ensureDir(TMP_DIR);
    await fs.writeFile(path.join(TMP_DIR, file), opts.buffer);
  } catch {
    /* ignore */
  }

  let imagePath = `local:${file}`;
  if (useBlobStorage()) {
    const blob = await put(`${BLOB_PREFIX}${file}`, opts.buffer, {
      access: "public",
      contentType: opts.contentType || `image/${ext}`,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    imagePath = blob.url;
  }

  const manifest = await readBomRiskManifest();
  const rec: BomRiskDayRecord = {
    day: opts.day,
    issuedAt: opts.issuedAt ?? new Date().toISOString(),
    regionId: opts.regionId,
    display: opts.display,
    imagePath,
    contentType: opts.contentType || `image/${ext}`,
    fileName: opts.fileName,
  };
  manifest.days[String(opts.day) as "1" | "2" | "3"] = rec;
  manifest.updatedAt = new Date().toISOString();
  await persistManifest(manifest);
  return rec;
}

export async function clearBomRiskDay(day: BomThunderstormDay): Promise<void> {
  const manifest = await readBomRiskManifest();
  const prev = manifest.days[String(day) as "1" | "2" | "3"];
  if (prev?.imagePath?.startsWith("local:")) {
    const rel = prev.imagePath.slice("local:".length);
    await fs.unlink(path.join(DATA_DIR, rel)).catch(() => undefined);
    await fs.unlink(path.join(TMP_DIR, rel)).catch(() => undefined);
  }
  if (prev?.imagePath?.startsWith("http") && useBlobStorage()) {
    try {
      await del(prev.imagePath);
    } catch {
      /* ignore */
    }
  }
  manifest.days[String(day) as "1" | "2" | "3"] = {
    day,
    issuedAt: null,
    regionId: prev?.regionId ?? "national",
    display: prev?.display ?? "sheet",
    imagePath: null,
    contentType: null,
    fileName: null,
  };
  manifest.updatedAt = new Date().toISOString();
  await persistManifest(manifest);
}

export async function ensureSeedBomRiskManifest(): Promise<BomRiskManifest> {
  // Only seed on a truly empty first run — never re-seed after an admin wipe.
  const local = await readManifestFile(MANIFEST_PATH);
  if (local) return local;
  const tmp = await readManifestFile(TMP_MANIFEST);
  if (tmp) return tmp;
  const blob = await readBlobManifest();
  if (blob) return blob;

  // Seed Day 1 with the sample NSW BoM product sheet shipped in public/.
  const seed: BomRiskManifest = emptyBomRiskManifest();
  seed.days["1"] = {
    day: 1,
    issuedAt: new Date().toISOString(),
    regionId: "nsw",
    display: "sheet",
    imagePath: "public:risk/bom-nsw-day1.jpg",
    contentType: "image/jpeg",
    fileName: "bom-nsw-day1.jpg",
  };
  await persistManifest(seed);
  return seed;
}
