import React from 'react'

// Deterministic gradient based on a string. Used to give each uploader a
// consistent, beautiful little circle without storing avatar URLs.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const PALETTES: Array<[string, string]> = [
  ['#f97316', '#db2777'],
  ['#06b6d4', '#3b82f6'],
  ['#8b5cf6', '#ec4899'],
  ['#10b981', '#06b6d4'],
  ['#f59e0b', '#ef4444'],
  ['#6366f1', '#a855f7'],
  ['#14b8a6', '#84cc16'],
  ['#0ea5e9', '#6366f1'],
]

interface AvatarProps {
  name: string
  size?: number
  title?: string
}

const Avatar: React.FC<AvatarProps> = ({ name, size = 24, title }) => {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  const [c1, c2] = PALETTES[hashString(name) % PALETTES.length]
  return (
    <div
      title={title ?? name}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        letterSpacing: '0.5px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.25)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials || '?'}
    </div>
  )
}

interface UploaderBadgeProps {
  uploader?: { display_name: string | null; username: string; is_admin: boolean } | null
  size?: number
  compact?: boolean
}

// Renders an uploader chip — but hides anything when the uploader is an admin.
export const UploaderBadge: React.FC<UploaderBadgeProps> = ({ uploader, size = 22, compact }) => {
  if (!uploader || uploader.is_admin) return null
  const name = uploader.display_name?.trim() || uploader.username
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: compact ? '0.72rem' : '0.8rem',
        color: 'var(--text2, #aaa)',
      }}
    >
      <Avatar name={name} size={size} />
      <span style={{ fontWeight: 600 }}>{name}</span>
    </span>
  )
}

export default Avatar
