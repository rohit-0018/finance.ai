// Lazy loader for Google Identity Services. We don't want this ~40KB script
// on every papermind page — only when the user opens the Life integrations
// screen or runs calendar sync.
//
// GIS exposes window.google.accounts.oauth2.initTokenClient() which gives us
// a one-hour access token in a popup. Refresh is done by silently re-issuing
// the token when expired (prompt: '' skips consent if already granted).

const GIS_SRC = 'https://accounts.google.com/gsi/client'

let loadPromise: Promise<void> | null = null

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            prompt?: string
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void
            error_callback?: (err: { type: string; message?: string }) => void
          }) => { requestAccessToken: (overrides?: { prompt?: string }) => void }
        }
      }
    }
  }
}

export function loadGis(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      loadPromise = null
      reject(new Error('Failed to load Google Identity Services'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}
