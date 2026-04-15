import { TouchableOpacity, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type Props = { onPress: () => void };

export default function BackButton({ onPress }: Props) {
  const { theme: T } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: T.card, alignItems: 'center', justifyContent: 'center',
        borderWidth: 0.5, borderColor: T.border,
      }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={{ fontSize: 18, color: T.text, marginTop: -2 }}>‹</Text>
    </TouchableOpacity>
  );
}
