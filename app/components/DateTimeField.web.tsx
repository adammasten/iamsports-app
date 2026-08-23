// Web: keep the plain typed input (native date/time pickers don't render on web).
// Same visual style as the form's other inputs.
import { StyleSheet, TextInput } from 'react-native';

export type DateTimeFieldProps = {
  mode: 'date' | 'time';
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export default function DateTimeField({ value, onChange, placeholder }: DateTimeFieldProps) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#666"
      autoCapitalize="none"
    />
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, color: '#f1f4f6', paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
});
