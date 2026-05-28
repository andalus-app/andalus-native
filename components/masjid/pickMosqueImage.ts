/**
 * pickMosqueImage — shared image pick + 5 MB validation for masjid flows.
 *
 * Uses expo-image-picker (quality 0.5 → compresses on pick; no
 * expo-image-manipulator / native rebuild). The size is measured from the
 * ACTUAL exported bytes (base64 length) — the same payload we upload — so it
 * never disagrees with the real upload size. NO Google APIs.
 *
 * Returns:
 *   { kind: 'image', uri, mime, size, base64 }  on success
 *   { kind: 'canceled' }                         user backed out
 *   { kind: 'too_big' }                          > 5 MB after compression
 *   { kind: 'unavailable' }                      picker/permission/read failed
 */
import * as FileSystem from 'expo-file-system/legacy';
import { MOSQUE_IMAGE_MAX_BYTES } from '../../services/mosques';

export type PickedMosqueImage = { uri: string; mime: string; size: number; base64: string };
export type PickMosqueImageResult =
  | ({ kind: 'image' } & PickedMosqueImage)
  | { kind: 'canceled' }
  | { kind: 'too_big' }
  | { kind: 'unavailable' };

export async function pickMosqueImage(): Promise<PickMosqueImageResult> {
  let ImagePicker: typeof import('expo-image-picker') | null = null;
  try { ImagePicker = require('expo-image-picker'); } catch { ImagePicker = null; }
  if (!ImagePicker) return { kind: 'unavailable' };

  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return { kind: 'unavailable' };

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      allowsEditing: false,
      presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
    });
    if (res.canceled || !res.assets?.[0]) return { kind: 'canceled' };

    const asset = res.assets[0];
    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    const size = Math.floor((base64.length * 3) / 4);
    if (size > MOSQUE_IMAGE_MAX_BYTES) return { kind: 'too_big' };

    return { kind: 'image', uri: asset.uri, mime: asset.mimeType ?? 'image/jpeg', size, base64 };
  } catch {
    return { kind: 'unavailable' };
  }
}
