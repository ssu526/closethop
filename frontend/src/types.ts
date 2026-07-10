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

export type ProcessingState =
  | "WAITING_FOR_UPLOAD"
  | "PROCESSING"
  | "READY"
  | "FAILED";

export type FailureReason = "UPLOAD" | "PROCESSING" | "DUPLICATE";

export interface WardrobeListItem {
  id: string;
  category: Category | null;
  imageUrl: string | null;
  processingState: ProcessingState;
  failureReason?: FailureReason | null;
  displayNote?: string | null;
}

export interface ClothingItemDetail extends WardrobeListItem {
  tags: string[];
}

export interface OutfitItem {
  id: string;
  category: Category | null;
  imageUrl: string | null;
  removedFromWardrobe: boolean;
}

export interface Outfit {
  id: string;
  items: OutfitItem[];
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
