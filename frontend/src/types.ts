export const categories = [
  "TOPS",
  "BOTTOMS",
  "DRESSES",
  "OUTERWEAR",
  "SHOES",
  "ACCESSORIES",
  "BAGS"
] as const;

export type Category = (typeof categories)[number];

export interface ClothingItem {
  id: string;
  category: Category | null;
  imageUrl: string | null;
  tags: string[];
  status:
    | "WAITING_FOR_UPLOAD"
    | "PROCESSING"
    | "READY"
    | "DUPLICATE_REJECTED"
    | "FAILED";
  processingError?: string | null;
  duplicateOfId?: string | null;
  removedFromWardrobe: boolean;
  subcategory?: string | null;
  colors: string[];
  pattern?: string | null;
  materials: string[];
  seasons: string[];
  occasions: string[];
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export type ClothingItemSummary = Omit<ClothingItem, "tags">;

export interface Outfit {
  id: string;
  items: ClothingItem[];
  userId: string;
  suggestedBy: {
    id: string;
    username: string;
  } | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageMetadata {
  size: number;
  number: number;
  totalElements: number;
  totalPages: number;
}

export interface PageResponse<T> {
  content: T[];
  page: PageMetadata;
}

export interface AuthResponse {
  userId: string;
  username: string;
  token: string;
}

export interface UserProfile {
  id: string;
  username: string;
  visibility: "PRIVATE" | "PUBLIC";
  clothingItemCount: number;
  categoryCounts: Partial<Record<Category, number>>;
  featuredOutfit: {
    id: string;
    imageUrls: string[];
  } | null;
}

export interface ApiErrorBody {
  status?: number;
  errorCode?: string;
  message?: string;
}
