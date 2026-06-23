const DEFAULT_PLACE_ID = 'ChIJYbabucgdDTkRAFAQTaS2fHM';

function getGoogleReviewUrl() {
  const explicit = (process.env.GOOGLE_REVIEW_URL || '').trim();
  if (explicit) return explicit;
  const placeId = (process.env.GOOGLE_PLACE_ID || DEFAULT_PLACE_ID).trim();
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

module.exports = { getGoogleReviewUrl };
