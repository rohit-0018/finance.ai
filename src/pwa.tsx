// PWA service-worker registration. vite-plugin-pwa exposes
// `virtual:pwa-register` which returns a function we can call to register
// the SW with auto-update behavior. Toasts surface a clear "new version"
// signal — no silent reloads, no broken state on update.
import { registerSW } from 'virtual:pwa-register'
import toast from 'react-hot-toast'

export function setupPwa() {
  if (typeof window === 'undefined') return

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast(
        (t) => (
          <span>
            New version available.{' '}
            <button
              onClick={() => {
                toast.dismiss(t.id)
                updateSW(true)
              }}
              style={{
                marginLeft: 8,
                padding: '2px 10px',
                borderRadius: 6,
                border: '1px solid var(--accent, #6366f1)',
                background: 'var(--accent, #6366f1)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Reload
            </button>
          </span>
        ),
        { duration: Infinity, id: 'pwa-update' }
      )
    },
    onOfflineReady() {
      toast.success('Ready to use offline', { duration: 3000 })
    },
  })
}
