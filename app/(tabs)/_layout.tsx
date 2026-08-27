import BottomNav from '../components/BottomNav';
import { Tabs } from 'expo-router';
import React from 'react';

// Nav unification: these four screens (Team wall / Roster / Schedule / My Tags)
// used to carry their own Expo tab bar (Team·Roster·Schedule·Tags), which fought
// the app-wide BottomNav and swapped the bottom bar as you moved. Now the ONE
// shared BottomNav (Home · Schedule · ➕ · Film Room · Coaches') is rendered as the
// tab bar here too, so the bar is identical everywhere. BottomNav returns null on
// web (WebTopNav handles the web nav). Team wall / Roster / My Tags are drill-ins
// reached from within a team, not standalone bottom tabs.
export default function TabLayout() {
  return (
    <Tabs tabBar={() => <BottomNav />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="roster" />
      <Tabs.Screen name="schedule" />
      <Tabs.Screen name="tags" />
    </Tabs>
  );
}