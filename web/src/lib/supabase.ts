import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY لازم يتحطوا في ملف .env')
}

// Dev only: talk to a local PostgREST with a test identity instead of Google sign-in.
const devToken = import.meta.env.DEV ? (import.meta.env.VITE_DEV_ACCESS_TOKEN as string | undefined) : undefined

export const supabase = devToken
  ? createClient(url, anonKey, { accessToken: async () => devToken })
  : createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })

export const isDevAuth = Boolean(devToken)
