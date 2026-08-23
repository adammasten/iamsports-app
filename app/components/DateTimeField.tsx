// Native (iOS/Android): a tappable field that opens the platform date/time picker.
// Keeps the form's string state shape (date = 'YYYY-MM-DD', time = a display string
// like '6:00 PM') so the screen's save/parse logic is unchanged. Web uses the
// .web.tsx sibling (a plain typed input) so this picker module never hits the web bundle.
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type DateTimeFieldProps = {
  mode: 'date' | 'time';
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
}
function fmtYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDisplayTime(s: string): Date {
  const d = new Date();
  const t = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!t) { d.setHours(18, 0, 0, 0); return d; }
  let h = parseInt(t[1], 10); const mi = t[2] ? parseInt(t[2], 10) : 0;
  if (t[3] === 'pm' && h < 12) h += 12;
  if (t[3] === 'am' && h === 12) h = 0;
  d.setHours(h, mi, 0, 0); return d;
}
function fmtDisplayTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function DateTimeField({ mode, value, onChange, placeholder }: DateTimeFieldProps) {
  const [show, setShow] = useState(false);
  const current = mode === 'date' ? parseYMD(value || '') : parseDisplayTime(value || '');
  const shown = value || placeholder || (mode === 'date' ? 'Pick a date' : 'Pick a time');

  return (
    <View>
      <View style={styles.fieldRow}>
        <TouchableOpacity style={[styles.input, { flex: 1 }]} onPress={() => setShow(s => !s)}>
          <Text style={value ? styles.val : styles.ph}>{shown}</Text>
        </TouchableOpacity>
        {mode === 'time' && value ? (
          <TouchableOpacity onPress={() => { onChange(''); setShow(false); }} hitSlop={8} style={styles.clear}>
            <Text style={styles.clearTxt}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {show ? (
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={current}
            mode={mode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant="dark"
            onChange={(e, d) => {
              if (Platform.OS !== 'ios') setShow(false);
              if (e.type === 'dismissed') return;
              if (d) onChange(mode === 'date' ? fmtYMD(d) : fmtDisplayTime(d));
            }}
          />
          {Platform.OS === 'ios' ? (
            <TouchableOpacity style={styles.done} onPress={() => setShow(false)}>
              <Text style={styles.doneTxt}>Done</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { backgroundColor: '#16232f', borderColor: '#25333f', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 13 },
  val: { color: '#f1f4f6', fontSize: 15 },
  ph: { color: '#666', fontSize: 15 },
  clear: { paddingHorizontal: 6, paddingVertical: 6 },
  clearTxt: { color: '#8b96a3', fontSize: 13, fontWeight: '700' },
  pickerWrap: { backgroundColor: '#16232f', borderRadius: 10, marginTop: 6, paddingBottom: Platform.OS === 'ios' ? 6 : 0 },
  done: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 8 },
  doneTxt: { color: '#ff6a2c', fontSize: 15, fontWeight: '800' },
});
