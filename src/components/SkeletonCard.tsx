import React from 'react'

const SkeletonCard: React.FC = () => (
  <div className="card skeleton-card">
    <div className="skeleton skeleton-line short" />
    <div className="skeleton skeleton-line" />
    <div className="skeleton skeleton-line" />
    <div className="skeleton skeleton-line short" />
  </div>
)

export default React.memo(SkeletonCard)
