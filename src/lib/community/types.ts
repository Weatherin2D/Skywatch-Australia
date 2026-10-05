export type CommunityPost = {
  id: string;
  title: string;
  author: string;
  /** Event date as YYYY-MM-DD (user-editable). */
  eventDate: string;
  /** Public path to serve the image (API proxy). */
  imageUrl: string;
  contentType: string;
  imagePath: string;
  createdAt: string;
};
