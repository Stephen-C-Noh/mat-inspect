import type { ReactElement, ReactNode } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
};

// Base only sets structural defaults (corner radius, shadow). Padding, border,
// and background are left to the caller so its classes do not collide with base
// utilities, which Tailwind does not resolve by string order.
export const Card = ({ children, className = '' }: CardProps): ReactElement => {
  return <div className={`rounded-3xl shadow-sm ${className}`}>{children}</div>;
};
