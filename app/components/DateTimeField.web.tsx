// Web: use the browser's OWN native date/time controls (a real <input type="date">
// calendar popup and <input type="time"> clock/spinner) instead of a typed box —
// the web equivalent of the iPhone wheel picker on native (DateTimeField.tsx).
//
// State shape is preserved for the form: date stays 'YYYY-MM-DD'; time is emitted
// as 'HH:MM' (24h), which the screen's parseTime() already accepts. Incoming time
// values (which may be a display string like '6:00 PM' for an existing event) are
// normalized to 'HH:MM' for the input.
import type { CSSProperties } from 'react';

export type DateTimeFieldProps = {
  mode: 'date' | 'time';
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

// '6:00 PM' | '18:00' | '6pm' → 'HH:MM' (or '' if unparseable/empty).
function toInputTime(v: string): string {
  if (!v) return '';
  const t = v.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!t) return '';
  let h = parseInt(t[1], 10);
  const m = t[2] ? parseInt(t[2], 10) : 0;
  if (t[3] === 'pm' && h < 12) h += 12;
  if (t[3] === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const inputStyle: CSSProperties = {
  backgroundColor: '#16232f',
  border: '1px solid #25333f',
  borderRadius: 10,
  color: '#f1f4f6',
  padding: '11px 12px',
  fontSize: 15,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  // Render the browser's native picker + spinners in dark to match the form.
  colorScheme: 'dark',
};

export default function DateTimeField({ mode, value, onChange, placeholder }: DateTimeFieldProps) {
  const inputValue = mode === 'time' ? toInputTime(value) : value;
  return (
    <input
      type={mode === 'date' ? 'date' : 'time'}
      value={inputValue}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
    />
  );
}
