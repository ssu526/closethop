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

  it("builds multipart clothing uploads", async () => {
    const OriginalBlob = globalThis.Blob;
    const blobSpy = vi.fn((blobParts?: BlobPart[], options?: BlobPropertyBag) => new OriginalBlob(blobParts, options));
    vi.stubGlobal("Blob", blobSpy);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1" }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    configureApi(async () => "token", () => undefined);
    await api.clothing.create({
      category: "TOPS",
      image: new File(["image"], "shirt.jpg", { type: "image/jpeg" })
    });
    const request = fetchMock.mock.calls[0][1];
    expect(request?.body).toBeInstanceOf(FormData);
    const item = (request?.body as FormData).get("item");
    expect(item).toBeInstanceOf(OriginalBlob);
    expect(blobSpy).toHaveBeenCalledWith([JSON.stringify({ category: "TOPS" })], { type: "application/json" });
    expect(new Headers(request?.headers).has("Content-Type")).toBe(false);
  });

  it("builds multipart replacement uploads", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "item-1" }), { status: 202, headers: { "Content-Type": "application/json" } })
    );
    configureApi(async () => "token", () => undefined);

    await api.clothing.replaceMissingUpload(
      "item-1",
      "TOPS",
      ["cotton"],
      new File(["image"], "shirt.png", { type: "image/png" })
    );

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/api/clothing/item-1/replacement");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("Content-Type")).toBe(false);
  });

  it("keeps a processed duplicate when the user confirms it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "item-1", status: "READY" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    configureApi(async () => "token", () => undefined);

    await api.clothing.keepDuplicate("item-1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:8080/api/clothing/item-1/duplicate/keep"
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
  });
});
