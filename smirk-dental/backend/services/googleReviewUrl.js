/** Smirk Dental — Google Maps listing (reviews). Used in WhatsApp review template button. */
const GOOGLE_REVIEW_URL =
  'https://www.google.com/maps/place/Smirk+Dental+Clinic+and+Implant+Centre+Vasant+Kunj/@28.5376251,77.1435663,17z/data=!4m8!3m7!1s0x390d1dc8b99bb661:0x737cb6a44d105000!8m2!3d28.5376204!4d77.1461412!9m1!1b1!16s%2Fg%2F11hdjb2c9k?entry=ttu';

function getGoogleReviewUrl() {
  return GOOGLE_REVIEW_URL;
}

module.exports = { getGoogleReviewUrl, GOOGLE_REVIEW_URL };
