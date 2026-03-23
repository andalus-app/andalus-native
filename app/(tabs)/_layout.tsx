import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function Layout() {
  const isDark = useColorScheme() === 'dark';
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: isDark ? '#0d0d0d' : '#fff', borderTopColor: isDark ? '#1a1a1a' : '#e0e0e0' },
      tabBarActiveTintColor: '#4CAF50',
      tabBarInactiveTintColor: isDark ? '#555' : '#aaa',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Bönetider', tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="qibla" options={{ title: 'Qibla', tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="dhikr" options={{ title: 'Dhikr', tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="asmaul" options={{ title: 'Asmaul Husna', tabBarIcon: ({ color, size }) => <Ionicons name="star-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="ebooks" options={{ title: 'E-böcker', tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="booking" options={{ title: 'Lokaler', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
