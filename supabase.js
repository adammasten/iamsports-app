import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const supabaseUrl = 'https://wscfpkaltajnrhiusoze.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzY2Zwa2FsdGFqbnJoaXVzb3plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MjkxNzksImV4cCI6MjA5MzAwNTE3OX0.0hJ0yJI8K_K78lGaAG3nc4ovzC6Py6Jk31-utE4c0sw'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
})