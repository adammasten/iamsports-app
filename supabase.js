import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const supabaseUrl = 'https://wscfpkaltajnrhiusoze.supabase.co'
const supabaseAnonKey = 'sb_publishable_CEXx7MDP_EMAExvLDHcdAg_Z5Cs_dvv'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
})