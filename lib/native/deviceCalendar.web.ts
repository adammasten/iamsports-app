// Web stub — there is no device calendar in the browser. The schedule screen
// hides this path on web and offers the .ics Export download instead. Present
// only so shared imports resolve without pulling expo-calendar into the web bundle.
import type { ScheduleEvent } from '@/lib/core/schedule';

export async function addEventsToDeviceCalendar(_events: ScheduleEvent[], _calTitle: string): Promise<number> {
  throw new Error('On the web, use the Export button to download a calendar file.');
}
