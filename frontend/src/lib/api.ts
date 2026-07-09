import type {
  ApiErrorBody,
  ClothingItem,
  ClothingItemSummary,
  Outfit,
  PageResponse,
  UserProfile
} from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
let tokenProvider: () => Promise<string | null> = async () => null;
let unauthorizedHandler: () => void = () => undefined;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

export function configureApi(
  getToken: () => Promise<string | null>,
  onUnauthorized: () => void
) {
  tokenProvider = getToken;
  unauthorizedHandler = onUnauthorized;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await tokenProvider();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (response.status === 401) unauthorizedHandler();
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = await response.json();
    } catch {
      // Preserve the HTTP status when the backend has no JSON error body.
    }
    throw new ApiError(body.message ?? `Request failed (${response.status})`, response.status, body.errorCode);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  return query.toString();
}

export const api = {
  login: (username: string, password: string) =>
    request<{ userId: string; username: string; token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  register: (email: string, username: string, password: string) =>
    request<{ userId: string; username: string; token: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password })
    }),
  users: {
    me: () => request<UserProfile>("/api/users/me"),
    setVisibility: (visibility: "PRIVATE" | "PUBLIC") =>
      request<UserProfile>("/api/users/me/visibility", {
        method: "PUT",
        body: JSON.stringify({ visibility })
      }),
    public: () => request<UserProfile[]>("/api/users/public"),
    profile: (userId: string) => request<UserProfile>(`/api/users/${userId}/profile`),
    outfits: (
      userId: string,
      filters: { page?: number; size?: number; includeCreated?: boolean; includeAccepted?: boolean } = {}
    ) =>
      request<PageResponse<Outfit>>(`/api/users/${userId}/outfits?${queryString({
        page: filters.page ?? 0,
        size: filters.size ?? 20,
        includeCreated: String(filters.includeCreated ?? true),
        includeAccepted: String(filters.includeAccepted ?? true)
      })}`),
    outfitSuggestions: (userId: string, page = 0, size = 20) =>
      request<PageResponse<Outfit>>(`/api/users/${userId}/outfit-suggestions?${queryString({ page, size })}`),
    suggestOutfit: (userId: string, clothingItemIds: string[]) =>
      request<Outfit>(`/api/users/${userId}/outfit-suggestions`, {
        method: "POST",
        body: JSON.stringify({ clothingItemIds })
      }),
    wardrobe: (
      userId: string,
      filters: { page?: number; size?: number; query?: string; category?: string } = {}
    ) =>
      request<PageResponse<ClothingItemSummary>>(`/api/users/${userId}/clothing?${queryString({
        page: filters.page ?? 0,
        size: filters.size ?? 12,
        query: filters.query,
        category: filters.category
      })}`)
  },
  clothing: {
    list: (filters: { page?: number; size?: number; query?: string; category?: string }) => {
      const category = filters.category;
      const searching = Boolean(filters.query);
      const base = searching
        ? "/api/clothing/search"
        : category
          ? `/api/clothing/category/${category}`
          : "/api/clothing";
      return request<PageResponse<ClothingItemSummary>>(
        `${base}?${queryString({
          page: filters.page ?? 0,
          size: filters.size ?? 12,
          query: filters.query,
          category
        })}`
      );
    },
    get: (id: string) => request<ClothingItem>(`/api/clothing/${id}`),
    create: async (values: { category: string; image: File }) => {
      const upload = await request<{
        itemId: string;
        uploadUrl: string;
        originalS3Key: string;
        expiresAt: string;
        item: ClothingItem;
      }>("/api/clothing/upload-url", {
        method: "POST",
        body: JSON.stringify({
          category: values.category,
          contentType: values.image.type || "image/jpeg"
        })
      });
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": values.image.type || "image/jpeg" },
        body: values.image
      });
      if (!response.ok) {
        try {
          await request<ClothingItem>(`/api/clothing/${upload.itemId}/upload-failed`, { method: "POST" });
        } catch {
          // Cleanup job will reconcile abandoned uploads if reporting failure fails.
        }
        throw new ApiError("Upload failed. Try again.", response.status);
      }
      return request<ClothingItem>(`/api/clothing/${upload.itemId}`);
    },
    update: (id: string, values: {
      category: string;
      tags: string[];
      subcategory?: string;
      colors?: string[];
      pattern?: string;
      materials?: string[];
      seasons?: string[];
      occasions?: string[];
    }) =>
      request<ClothingItem>(`/api/clothing/${id}`, {
        method: "PUT",
        body: JSON.stringify(values)
      }),
    delete: (id: string) => request<void>(`/api/clothing/${id}`, { method: "DELETE" })
  },
  outfits: {
    list: (filters: {
      page?: number;
      size?: number;
      includeCreated?: boolean;
      includeAccepted?: boolean;
    } = {}) =>
      request<PageResponse<Outfit>>(`/api/outfits?${queryString({
        page: filters.page ?? 0,
        size: filters.size ?? 12,
        includeCreated: String(filters.includeCreated ?? true),
        includeAccepted: String(filters.includeAccepted ?? true)
      })}`),
    get: (id: string) => request<Outfit>(`/api/outfits/${id}`),
    pendingSuggestions: (page = 0, size = 12) =>
      request<PageResponse<Outfit>>(`/api/outfits/pending-suggestions?${queryString({ page, size })}`),
    accept: (id: string) =>
      request<Outfit>(`/api/outfits/${id}/accept`, { method: "POST" }),
    create: (values: { clothingItemIds: string[] }) =>
      request<Outfit>("/api/outfits", { method: "POST", body: JSON.stringify(values) }),
    update: (id: string, values: { clothingItemIds: string[] }) =>
      request<Outfit>(`/api/outfits/${id}`, { method: "PUT", body: JSON.stringify(values) }),
    suggest: (clothingItemIds: string[], category: string) =>
      request<ClothingItem[]>("/api/outfits/suggestions", {
        method: "POST",
        body: JSON.stringify({ clothingItemIds, category })
      }),
    delete: (id: string) => request<void>(`/api/outfits/${id}`, { method: "DELETE" })
  }
};
