import { Stack } from 'expo-router';
import { RO_BG } from '../../../components/ruqyah/ruqyahColors';

export default function RuqyahCategoryLayout() {
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
