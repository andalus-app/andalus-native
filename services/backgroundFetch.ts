// Background fetch är deprecated i Expo SDK 54.
// Notiser skickas istället från useYoutubeLive (live-detektering)
// och från home.tsx (nya banners) när appen är aktiv.
export async function registerBackgroundFetch(): Promise<void> {
  // no-op — hanteras via foreground polling
}
