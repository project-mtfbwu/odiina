import { z } from "zod";

export const profileDisplayNameMaximum = 80;
export const profileBioMaximum = 500;
export const profileHandleMinimum = 3;
export const profileHandleMaximum = 30;

export const reservedProfileHandles = new Set([
  "odiina",
  "admin",
  "api",
  "auth",
  "login",
  "logout",
  "onboarding",
  "feed",
  "calendar",
  "profile",
  "settings",
  "trash",
  "entries",
  "reviews",
  "insights",
]);

export function normalizeProfileHandle(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

const displayNameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => Array.from(value).length > 0, "Enter a display name.")
  .refine(
    (value) => Array.from(value).length <= profileDisplayNameMaximum,
    `Use ${profileDisplayNameMaximum} characters or fewer.`,
  );

const handleSchema = z
  .string()
  .transform(normalizeProfileHandle)
  .refine(
    (value) =>
      value.length >= profileHandleMinimum &&
      value.length <= profileHandleMaximum,
    `Use ${profileHandleMinimum}–${profileHandleMaximum} characters.`,
  )
  .refine(
    (value) => /^[a-z][a-z0-9_]*$/.test(value),
    "Start with a letter and use lowercase letters, numbers, or underscores.",
  )
  .refine(
    (value) => !reservedProfileHandles.has(value),
    "That handle is unavailable. Choose another.",
  );

export const saveProfileSchema = z.object({
  displayName: displayNameSchema,
  handle: handleSchema,
  bio: z
    .string()
    .refine(
      (value) => Array.from(value).length <= profileBioMaximum,
      `Use ${profileBioMaximum} characters or fewer.`,
    ),
  avatarAttachmentId: z.string().uuid().nullable(),
  bannerAttachmentId: z.string().uuid().nullable(),
});

export const profileMediaRoleSchema = z.enum(["avatar", "banner"]);

export const authorizeProfileImageSchema = z.object({
  mediaRole: profileMediaRoleSchema,
  filename: z.string().trim().min(1).max(180),
  declaredMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteCount: z
    .number()
    .int()
    .min(1)
    .max(15 * 1024 * 1024),
});
