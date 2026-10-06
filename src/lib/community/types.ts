export type CommunityComment = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
};

export type CommunityPost = {
  id: string;
  title: string;
  author: string;
  /** Optional caption / description text. */
  caption: string;
  /** Event date as YYYY-MM-DD (user-editable). */
  eventDate: string;
  /** Public path to serve the image (API proxy). */
  imageUrl: string;
  contentType: string;
  imagePath: string;
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
