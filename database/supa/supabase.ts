/// <reference types="vite/client" />

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isCloudConfigured = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  !supabaseUrl.startsWith('REPLACE_') &&
  !supabasePublishableKey.startsWith('REPLACE_'),
)

export const supabase = isCloudConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null
