export function ChatInputGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-x-10 -inset-y-7"
    >
      {/* Amber layer — starts visible, fades out at 50% */}
      <div
        className="absolute inset-0 animate-glow-amber"
        style={{
          background:
            "radial-gradient(ellipse 90% 85% at 50% 50%, hsl(38 92% 50% / var(--glow-opacity)), transparent 68%)",
          filter: "blur(14px)",
        }}
      />
      {/* Blue layer — starts invisible, fades in at 50% */}
      <div
        className="absolute inset-0 animate-glow-yellow"
        style={{
          background:
            "radial-gradient(ellipse 90% 85% at 50% 50%, hsl(210 90% 58% / var(--glow-opacity)), transparent 68%)",
          filter: "blur(14px)",
        }}
      />
    </div>
  );
}
