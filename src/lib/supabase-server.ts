import { createClient } from '@supabase/supabase-js'

export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // Next.js on Vercel patches global fetch and will cache these requests
      // by default even on force-dynamic routes, silently serving stale rows
      // (writes succeed, but subsequent reads through this client don't see
      // them). Force every request this client makes to bypass that cache.
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    }
  )
}
