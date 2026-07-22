export const featureFlags = Object.freeze({
  ai: process.env.ODIINA_FEATURE_AI === "true",
  uploads: process.env.ODIINA_FEATURE_UPLOADS === "true",
  imageUploads: process.env.ODIINA_FEATURE_IMAGE_UPLOADS === "true",
  videoUploads: process.env.ODIINA_FEATURE_VIDEO_UPLOADS === "true",
  audioUploads: process.env.ODIINA_FEATURE_AUDIO_UPLOADS === "true",
  places: process.env.ODIINA_FEATURE_PLACES === "true",
  worker: process.env.ODIINA_FEATURE_WORKER === "true",
  sharing: process.env.ODIINA_FEATURE_SHARING === "true",
  periodReports: process.env.ODIINA_FEATURE_PERIOD_REPORTS === "true",
});
