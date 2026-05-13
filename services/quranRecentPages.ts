import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'quran_recent_pages_v1';
const MAX_ITEMS = 3;

export interface RecentPage {
  page: number;
  surahId: number;
  surahName: string;
  visitedAt: number;
}

export async function loadRecentPages(): Promise<RecentPage[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentPage[]) : [];
  } catch {
    return [];
  }
}

export async function saveRecentPage(
  page: number,
  surahId: number,
  surahName: string,
): Promise<RecentPage[]> {
  try {
    const existing = await loadRecentPages();
    const filtered = existing.filter((p) => p.page !== page);
    const updated: RecentPage[] = [
      { page, surahId, surahName, visitedAt: Date.now() },
      ...filtered,
    ].slice(0, MAX_ITEMS);
    await AsyncStorage.setItem(KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}
