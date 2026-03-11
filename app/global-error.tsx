"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          height: "100dvh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "48px",
              fontWeight: "bold",
              color: "#888",
              fontFamily: "monospace",
            }}
          >
            500
          </span>
          <h1 style={{ fontSize: "24px", fontWeight: 600, margin: "8px 0" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#666", fontSize: "14px", maxWidth: "320px" }}>
            An unexpected error occurred. Please try again.
          </p>
        </div>
        <button
          onClick={reset}
          style={{
            padding: "8px 16px",
            border: "1px solid #ddd",
            borderRadius: "6px",
            background: "transparent",
            cursor: "pointer",
            fontSize: "14px",
          }}
          type="button"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
