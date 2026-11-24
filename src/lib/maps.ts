// Google Maps JS loader. Key comes from VITE_GOOGLE_MAPS_KEY at build time (GitHub secret).
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
let loading: Promise<typeof google.maps> | null = null;

export const hasMapsKey = () => !!KEY;

export function loadMaps(): Promise<typeof google.maps> {
  if (!KEY) return Promise.reject(new Error('No VITE_GOOGLE_MAPS_KEY set'));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const cb = '__scaMapsReady';
    (window as unknown as Record<string, () => void>)[cb] = () => resolve(google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&libraries=places,geometry&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return loading;
}

export const LA = { lat: 34.0522, lng: -118.2437 };
