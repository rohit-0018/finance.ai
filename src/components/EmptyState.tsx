import React from 'react'

interface EmptyStateProps {
  icon?: string
  title: string
  description: string
  children?: React.ReactNode
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon = '?',
  title,
  description,
  children,
}) => (
  <div className="empty-state">
    <div className="empty-state-icon">{icon}</div>
    <div className="empty-state-title">{title}</div>
    <div className="empty-state-desc">{description}</div>
    {children && <div className="empty-state-actions">{children}</div>}
  </div>
)

export default EmptyState
