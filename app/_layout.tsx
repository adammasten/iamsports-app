import { TeamProvider } from '@/context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/supabase';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setReady(true);
      if (!session) {
        setTimeout(() => router.replace('/login'), 100);
      } else {
        setTimeout(() => router.replace('/select-team'), 100);
      }
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
      else router.replace('/select-team');
    });
  }, []);

  return (
    <TeamProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="game" options={{ headerShown: false }} />
          <Stack.Screen name="tagging" options={{ headerShown: false }} />
          <Stack.Screen name="clips" options={{ headerShown: false }} />
          <Stack.Screen name="export" options={{ headerShown: false }} />
          <Stack.Screen name="select-team" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </TeamProvider>
  );
}