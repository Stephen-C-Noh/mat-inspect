export function Card({ className = "", children }) {
  return (
    <div
      className={
        "border rounded-xl shadow-sm bg-white " + className
      }
    >
      {children}
    </div>
  );
}

export function CardHeader({ children }) {
  return <div className="p-4 border-b">{children}</div>;
}

export function CardContent({ children }) {
  return <div className="p-4">{children}</div>;
}
