import { StyleSheet, Text, useColorScheme, View } from 'react-native';

export default function Qibla() {
  const isDark = useColorScheme() === 'dark';
  const styles = makeStyles(isDark);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Qibla</Text>
      <Text style={styles.subtitle}>Kommer snart...</Text>
    </View>
  );
}

function makeStyles(isDark: boolean) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 28, fontWeight: 'bold', color: isDark ? '#fff' : '#111' },
    subtitle: { fontSize: 16, color: isDark ? '#888' : '#666', marginTop: 8 },
  });
}