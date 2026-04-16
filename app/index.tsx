import { Redirect } from 'expo-router';

// Fallback for the root path (hidayah:///) — redirects to the home tab.
// This prevents "Unmatched Route" when the app is opened cold via a notification
// that has no deep-link data.
export default function Index() {
  return <Redirect href="/(tabs)/home" />;
}
