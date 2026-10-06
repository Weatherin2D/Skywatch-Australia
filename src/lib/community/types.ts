export type CommunityComment = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
};

/** One photo inside a community post (cover or gallery extra). */
export type CommunityImageAsset = {
  id: string;
  imageUrl: string;
  contentType: string;
  imagePath: string;
};

export type CommunityPost = {
  id: string;
  title: string;
  author: string;
  /** Optional caption / description text. */
  caption: string;
  /** Event date as YYYY-MM-DD (user-editable). */
  eventDate: string;
  /** Cover / primary image (same as images[0] when present). */
  imageUrl: string;
  contentType: string;
  imagePath: string;
  /** All photos in this post (1+). Older posts may omit; clients should fall back to cover fields. */
  images: CommunityImageAsset[];
  createdAt: string;
  likes: number;
  comments: CommunityComment[];
};

export type PictureFormatFilter = "all" | "jpeg" | "png" | "webp";

export type CommunityBackend = "redis" | "blob" | "local" | "none";

export type StorageStatus = {
  durable: boolean;
  backend: CommunityBackend;
  /** True when running on Vercel. */
  vercel: boolean;
  detail: string;
};
