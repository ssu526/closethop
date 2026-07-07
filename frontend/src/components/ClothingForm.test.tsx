import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClothingItem } from "../types";
import { ClothingForm } from "./ClothingForm";

afterEach(cleanup);

describe("ClothingForm", () => {
  it("requires an image and category when creating an item", async () => {
    URL.createObjectURL = vi.fn(() => "blob:new-item");
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();
    render(<ClothingForm busy={false} onSubmit={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "Add to wardrobe" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("Category")).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText(/^Photograph/),
      new File(["image"], "shirt.jpg", { type: "image/jpeg" })
    );
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Tops" }));
    expect(submit).toBeEnabled();
  });

  it("requires a replacement image and category before enabling upload", async () => {
    URL.createObjectURL = vi.fn(() => "blob:replacement");
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();
    const item: ClothingItem = {
      id: "item-1",
      category: null,
      imageUrl: null,
      tags: [],
      status: "NEEDS_INPUT",
      processingError: "ORIGINAL_UNAVAILABLE",
      removedFromWardrobe: false,
      colors: [],
      materials: [],
      seasons: [],
      occasions: [],
      userId: "user-1",
      createdAt: "2026-07-04T00:00:00Z",
      updatedAt: "2026-07-04T00:00:00Z"
    };

    render(<ClothingForm item={item} busy={false} onSubmit={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "Upload again" });
    expect(submit).toBeDisabled();

    await user.upload(
      screen.getByLabelText(/^Photograph/),
      new File(["image"], "replacement.png", { type: "image/png" })
    );
    expect(submit).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Category"), "TOPS");
    expect(submit).toBeEnabled();
  });
});
