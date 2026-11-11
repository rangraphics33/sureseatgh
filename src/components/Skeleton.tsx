type SkeletonProps = {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />
}

export function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-label="Loading dashboard preview">
      <div className="skeleton-stats">
        {[1, 2, 3].map((item) => (
          <div className="panel skeleton-stat" key={item}>
            <Skeleton className="skeleton-short" />
            <Skeleton className="skeleton-number" />
          </div>
        ))}
      </div>
      <div className="panel skeleton-panel">
        <Skeleton className="skeleton-heading" />
        <Skeleton className="skeleton-line" />
        <Skeleton className="skeleton-line" />
      </div>
    </div>
  )
}

export function SectionSkeleton({ variant }: { variant: 'booking' | 'trips' | 'table' | 'profile' }) {
  if (variant === 'profile') {
    return <div className="panel skeleton-panel"><Skeleton className="skeleton-heading" /><div className="skeleton-stats"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div><Skeleton className="skeleton-line" /></div>
  }
  if (variant === 'table') {
    return <div className="panel skeleton-panel"><Skeleton className="skeleton-heading" />{[1, 2, 3, 4].map((item) => <Skeleton className="skeleton-line" key={item} />)}</div>
  }
  return <div className="section-skeleton">{variant === 'booking' && <div className="panel skeleton-panel"><Skeleton className="skeleton-heading" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div>}{[1, 2].map((item) => <div className="panel skeleton-trip" key={item}><Skeleton className="skeleton-heading" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div>)}</div>
}
