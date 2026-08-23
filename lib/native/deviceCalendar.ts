// Native (iOS/Android): write upcoming schedule events into the device calendar.
// Web uses the .web.ts stub (and the schedule screen offers the .ics Export button
// there instead), so expo-calendar never enters the web bundle.
import { eventTypeLabel, isGameFamily, type ScheduleEvent } from '@/lib/core/schedule';
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

function titleFor(ev: ScheduleEvent): string {
  return ev.title || (isGameFamily(ev.eventType) && ev.opponent ? `vs ${ev.opponent}` : eventTypeLabel(ev.eventType));
}

// Start/end/allDay for one event. Timed events with a known start get a real
// window (explicit end, else +2h games / +1h everything else). TBD/all-day
// events become a single all-day entry.
function eventWindow(ev: ScheduleEvent): { start: Date; end: Date; allDay: boolean } {
  if (ev.timeStatus === 'confirmed' && ev.startsAt) {
    const start = new Date(ev.startsAt);
    const end = ev.endsAt ? new Date(ev.endsAt) : new Date(start.getTime() + (isGameFamily(ev.eventType) ? 120 : 60) * 60000);
    return { start, end, allDay: false };
  }
  const [y, m, d] = ev.localDate.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000), allDay: true };
}

async function writableCalendarId(): Promise<string> {
  if (Platform.OS === 'ios') {
    const def = await Calendar.getDefaultCalendarAsync();
    if (def?.id) return def.id;
  }
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = cals.find(c => c.allowsModifications) ?? cals[0];
  if (!writable) throw new Error('No writable calendar was found on this device.');
  return writable.id;
}

// Adds each (non-canceled) event to the device calendar. Returns how many landed.
export async function addEventsToDeviceCalendar(events: ScheduleEvent[], calTitle: string): Promise<number> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') throw new Error('Calendar access wasn’t granted — enable it in Settings to add events.');
  const calId = await writableCalendarId();
  let count = 0;
  for (const ev of events) {
    if (ev.status === 'canceled') continue;
    const { start, end, allDay } = eventWindow(ev);
    const location = [ev.venueName, ev.venueAddress].filter(Boolean).join(', ');
    const notes = [ev.uniform ? `Uniform: ${ev.uniform}` : '', ev.notes ?? ''].filter(Boolean).join('\n');
    await Calendar.createEventAsync(calId, {
      title: `${calTitle}: ${titleFor(ev)}`,
      startDate: start, endDate: end, allDay,
      timeZone: ev.eventTimezone,
      location: location || undefined,
      notes: notes || undefined,
      alarms: isGameFamily(ev.eventType) && !allDay ? [{ relativeOffset: -120 }] : undefined,
    });
    count++;
  }
  return count;
}
