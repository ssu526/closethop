import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { ClothingItem } from "../types";
import { categories } from "../types";
import { Button, Field, inputClass } from "./ui";

const schema = z.object({
  category: z.string().optional(),
  tags: z.string().optional(),
  image: z.instanceof(FileList).optional()
});
type Values = z.infer<typeof schema>;

export function ClothingForm({
  item,
  busy,
  onSubmit
}: {
  item?: ClothingItem;
  busy: boolean;
  onSubmit(values: {
    category?: string;
    tags?: string[];
    image?: File;
  }): void;
}) {
  const isCreate = !item;
  const showImage = isCreate;
  const showCategory = isCreate || Boolean(item);
  const { register, handleSubmit, reset, formState, watch } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: item?.category ?? "",
      tags: item?.tags.join(", ") ?? ""
    }
  });
  useEffect(() => reset({
    category: item?.category ?? "",
    tags: item?.tags.join(", ") ?? ""
  }), [item, reset]);
  const image = showImage ? watch("image")?.[0] : undefined;
  const category = watch("category");
  const preview = useMemo(() => image ? URL.createObjectURL(image) : undefined, [image]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <form className="space-y-5" onSubmit={handleSubmit((values) => onSubmit({
      category: values.category?.trim() || undefined,
      tags: values.tags?.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 20),
      image: values.image?.[0]
    }))}>
      {showImage && (
        <Field label="Photograph" error={formState.errors.image?.message}>
          <input className={`${inputClass} file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-xs file:font-semibold file:text-paper`} type="file" accept="image/jpeg,image/png" required={showImage} {...register("image", { required: showImage && "Choose a photograph." })} />
          {isCreate && (
            <p className="text-xs font-normal leading-5 text-ink/45">
              <span className="font-semibold text-ink/60">Tip:</span> For the
              best cutout, photograph your clothing against a contrasting
              background. If the background is too similar to the item, it may
              not be removed correctly.
            </p>
          )}
          {preview && <img className="mt-3 max-h-56 w-full rounded-2xl border border-stone object-contain p-2" src={preview} alt="Upload preview" />}
        </Field>
      )}
      {showCategory && (
        <>
          {isCreate ? (
            <fieldset className="space-y-2 text-sm font-semibold text-ink">
              <legend>Category</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {categories.map((value) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-stone px-3 text-xs font-semibold text-ink/65 transition has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper"
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      value={value}
                      {...register("category", { required: "Choose a category." })}
                    />
                    {value.charAt(0) + value.slice(1).toLowerCase()}
                  </label>
                ))}
              </div>
              {formState.errors.category?.message && (
                <span className="block text-xs font-normal text-red-700">
                  {formState.errors.category.message}
                </span>
              )}
            </fieldset>
          ) : (
            <Field label="Category" error={formState.errors.category?.message}>
              <select required className={inputClass} {...register("category")}>
                <option value="">Choose a category</option>
                {categories.map((category) => <option key={category} value={category}>{category.charAt(0) + category.slice(1).toLowerCase()}</option>)}
              </select>
            </Field>
          )}
          {item && (
            <Field label="Tags" error={formState.errors.tags?.message}>
              <input className={inputClass} placeholder="t-shirt, navy, crew neck" {...register("tags")} />
              <p className="text-xs font-normal leading-5 text-ink/45">
                Separate tags with commas. Maximum 20 tags.
              </p>
            </Field>
          )}
        </>
      )}
      <div className={item ? "pt-3" : ""}>
        <Button
          className="w-full"
          type="submit"
          disabled={
            busy ||
            Boolean(showImage && !image) ||
            Boolean(isCreate && !category) ||
            Boolean(item && !category)
          }
        >
          {item ? "Save changes" : "Add to wardrobe"}
        </Button>
      </div>
    </form>
  );
}
