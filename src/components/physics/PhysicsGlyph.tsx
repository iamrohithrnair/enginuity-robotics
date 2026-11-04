"use client";

 
 

export function PhysicsGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21h18" />
      <rect x="7" y="9" width="10" height="8.5" rx="1.6" />
      <path d="M9 2.5v3.5M12 2.5v3.5M15 2.5v3.5" />
    </svg>
  );
}
