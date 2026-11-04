 
// at commit 4662fff), MIT License, Copyright (c) 2024-2026 pqoqubbw: see ./LICENSE. The icon artwork is
// Lucide's (https://lucide.dev), ISC License, Copyright (c) 2026 Lucide Icons and Contributors; both
 
 
 
"use client";

import type { Variants } from "motion/react";
import { LazyMotion, domAnimation, m, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export interface CctvIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CctvIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CCTV_GROUP_VARIANTS: Variants = {
  normal: {
    rotate: 0,
    y: 0,
    x: 0,
  },
  animate: {
    rotate: [0, -20, -20, 15, 15, 0],
    y: [0, -0.5, -0.5, 0, 0, 0],
    x: [0, 0, 0, 0.5, 0.5, 0],
    transition: {
      duration: 1.8,
      ease: "easeInOut",
    },
  },
};

const CCTV_PATH_VARIANTS: Variants = {
  normal: {
    opacity: 1,
  },
  animate: {
    opacity: [1, 0, 1, 0, 1, 0, 1],
    transition: {
      duration: 1.8,
      ease: "easeInOut",
    },
  },
};

const CctvIcon = forwardRef<CctvIconHandle, CctvIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave]
    );
    return (
      <LazyMotion features={domAnimation}>
        <div
          className={className}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          {...props}
        >
          <svg
            fill="none"
            height={size}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width={size}
            xmlns="http://www.w3.org/2000/svg"
          >
            <m.g
              animate={controls}
              initial="initial"
              variants={CCTV_GROUP_VARIANTS}
            >
              <path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97" />
              <path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z" />
              <m.path
                animate={controls}
                d="M7 9h.01"
                variants={CCTV_PATH_VARIANTS}
              />
            </m.g>
            <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15" />
            <path d="M2 21v-4" />
          </svg>
        </div>
      </LazyMotion>
    );
  }
);

CctvIcon.displayName = "CctvIcon";

export { CctvIcon };
