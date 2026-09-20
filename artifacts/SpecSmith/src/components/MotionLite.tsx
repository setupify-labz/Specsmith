import { createElement, forwardRef, type ReactNode } from 'react';

type MotionValue = string | number | Array<string | number>;
type MotionLiteProps = {
  children?: ReactNode;
  style?: Record<string, unknown>;
  animate?: Record<string, MotionValue>;
  [key: string]: unknown;
};

const MOTION_ONLY_PROPS = new Set([
  'initial',
  'animate',
  'exit',
  'transition',
  'whileInView',
  'whileHover',
  'whileTap',
  'viewport',
  'layout',
  'layoutId',
]);

const CSS_ANIMATE_PROPS = new Set([
  'opacity',
  'width',
  'height',
  'left',
  'right',
  'top',
  'bottom',
  'backgroundColor',
  'color',
]);

function finalValue(value: MotionValue) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function createMotionElement(tag: 'button' | 'div' | 'line' | 'main' | 'p' | 'path' | 'span' | 'tr') {
  return forwardRef<unknown, MotionLiteProps>(function MotionLiteElement(props, ref) {
    const domProps: Record<string, unknown> = {};
    const style: Record<string, unknown> = { ...(props.style as Record<string, unknown> | undefined) };

    for (const [key, value] of Object.entries(props)) {
      if (!MOTION_ONLY_PROPS.has(key) && key !== 'style') domProps[key] = value;
    }

    const animate = props.animate;
    if (animate && typeof animate === 'object') {
      const transforms: string[] = [];
      for (const [key, rawValue] of Object.entries(animate)) {
        const value = finalValue(rawValue);
        if (key === 'x') transforms.push(`translateX(${typeof value === 'number' ? `${value}px` : value})`);
        else if (key === 'y') transforms.push(`translateY(${typeof value === 'number' ? `${value}px` : value})`);
        else if (key === 'scale') transforms.push(`scale(${value})`);
        else if (key === 'rotate') transforms.push(`rotate(${typeof value === 'number' ? `${value}deg` : value})`);
        else if (tag === 'path' || tag === 'line') domProps[key] = value;
        else if (CSS_ANIMATE_PROPS.has(key)) style[key] = value;
      }
      if (transforms.length > 0) style.transform = transforms.join(' ');
    }

    domProps.style = style;
    domProps.ref = ref;
    return createElement(tag, domProps);
  });
}

/**
 * Final-state rendering for ordinary reveal and presence effects.
 * Interactive crate animations keep using Framer Motion; normal pages avoid
 * downloading and executing an animation runtime before they become usable.
 */
export const motion = {
  button: createMotionElement('button'),
  div: createMotionElement('div'),
  line: createMotionElement('line'),
  main: createMotionElement('main'),
  p: createMotionElement('p'),
  path: createMotionElement('path'),
  span: createMotionElement('span'),
  tr: createMotionElement('tr'),
};

export function AnimatePresence({ children }: { children?: ReactNode; mode?: string }) {
  return <>{children}</>;
}
