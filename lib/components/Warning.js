import React from "react"
import clsx from "clsx"

export default function Warning({ className, children }) {
  const cls = clsx(
    [
      "my-4",
      "p-4",
      "bg-orange-100",
      "border",
      "border-orange-300",
      "text-orange-800",
      "rounded-lg",
      "flex",
    ],
    className
  )

  return (
    <aside className={cls}>
      <svg
        className="text-orange-900 fill-current mr-2"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="24"
        height="24"
      >
        <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 9a1 1 0 0 1-1-1V8a1 1 0 0 1 2 0v4a1 1 0 0 1-1 1zm0 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
      </svg>
      <div className="flex-1">{children}</div>
    </aside>
  )
}