// Google Maps Platform browser key. Public by design: it ships in the page bundle and is
// restricted in Google Cloud to this site's referrers and to the 8 Maps APIs.
// A build-time VITE_GOOGLE_MAPS_KEY (GitHub secret) overrides it.
export const GOOGLE_KEY: string =
  (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) || 'AIzaSyCc5_4CEQvt6pS5ao9WBy_P7ldVHhtB0Rs';

export const LA: [number, number] = [-118.2437, 34.0522]; // [lng, lat]
