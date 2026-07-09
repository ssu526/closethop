import { afterEach, describe, expect, it, vi } from "vitest";
import { api, configureApi } from "./api";

describe("API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("attaches the current bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [], page: { size: 12, number: 0, totalElements: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    configureApi(async () => "test-token", () => undefined);
    await api.clothing.list({});
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer test-token");
    expect(fetchMock.mock.calls[0][0]).toContain("/api/clothing?");
  });

  it("fetches all personal clothing when no category or query is provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [], page: { size: 100, number: 0, totalElements: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    configureApi(async () => null, () => undefined);

    await api.clothing.list({ page: 0, size: 100 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/clothing?");
    expect(url).not.toContain("category=TOPS");
  });

  it("uses the category endpoint when a personal clothing category is provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [], page: { size: 12, number: 0, totalElements: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    configureApi(async () => null, () => undefined);

    await api.clothing.list({ category: "DRESSES" });

    expect(fetchMock.mock.calls[0][0]).toContain("/api/clothing/category/DRESSES?");
  });

  it("fetches all public wardrobe clothing when no category is provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [], page: { size: 100, number: 0, totalElements: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    configureApi(async () => null, () => undefined);

    await api.users.wardrobe("user-2", { page: 0, size: 100 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/users/user-2/clothing?");
    expect(url).not.toContain("category=TOPS");
  });

  it("includes public wardrobe category only when provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [], page: { size: 12, number: 0, totalElements: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    configureApi(async () => null, () => undefined);

    await api.users.wardrobe("user-2", { category: "DRESSES" });

    expect(fetchMock.mock.calls[0][0]).toContain("category=DRESSES");
  });

  it("notifies the auth layer on unauthorized responses", async () => {
    const unauthorized = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    configureApi(async () => null, unauthorized);
    await expect(api.outfits.list()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("creates direct S3 clothing uploads", async () => {
    const createdItem = {
      id: "1",
      category: "TOPS",
      imageUrl: "https://images.example/users/user-1/original/1.jpg",
      status: "PROCESSING",
      processingError: null,
      duplicateOfId: null,
      removedFromWardrobe: false,
      subcategory: null,
      colors: [],
      pattern: null,
      materials: [],
      seasons: [],
      occasions: [],
      userId: "user-1",
      tags: [],
      createdAt: "2026-07-08T16:00:00",
      updatedAt: "2026-07-08T16:00:00"
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          itemId: "1",
          uploadUrl: "https://s3.example/upload",
          originalS3Key: "users/user-1/original/1.jpg",
          expiresAt: "2026-07-08T16:00:00",
          item: { id: "1", status: "WAITING_FOR_UPLOAD" }
        }), { status: 201, headers: { "Content-Type": "application/json" } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createdItem), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    configureApi(async () => "token", () => undefined);
    const image = new File(["image"], "shirt.jpg", { type: "image/jpeg" });
    const result = await api.clothing.create({
      category: "TOPS",
      image
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/clothing/upload-url");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({
      category: "TOPS",
      contentType: "image/jpeg"
    }));
    expect(fetchMock.mock.calls[1][0]).toBe("https://s3.example/upload");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[1][1]?.body).toBe(image);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Content-Type")).toBe("image/jpeg");
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8080/api/clothing/1");
    expect(result).toEqual(createdItem);
  });

});
