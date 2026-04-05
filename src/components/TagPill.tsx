import React from 'react'
import { sourceToColor } from '../lib/utils'

interface TagPillProps {
  label: string
  color?: string
  source?: boolean
}

const TagPill: React.FC<TagPillProps> = ({ label, color, source }) => {
  const pillColor = color ?? (source ? sourceToColor(label) : 'var(--text3)')

  return (
    <span
      className="tag-pill"
      style={{
        color: pillColor,
        borderColor: `${pillColor}33`,
        backgroundColor: `${pillColor}0d`,
      }}
    >
      {label}
    </span>
  )
}

export default React.memo(TagPill)
