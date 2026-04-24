import { Stack } from 'expo-router';
import { RO_BG } from '../../components/ruqyah/ruqyahColors';

/**
 * Ruqyah sub-app navigator.
 *
 * fullScreenGestureEnabled: false  — only edge swipe triggers back,
 *   never a mid-screen swipe that would feel like leaving the sub-app.
 *
 * detachPreviousScreen: false — keeps the index screen fully attached
 *   in the view hierarchy while [slug] is open, so back navigation
 *   is instant with no re-render cost.
 *
 * contentStyle — matches the dark navy background so there is no
 *   white flash between screens during the slide animation.
 */
export default function RuqyahLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: RO_BG },
      }}
    />
  );
}
