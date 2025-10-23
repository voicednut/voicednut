import { classNames, isRecord, type ClassValue } from '@/css/classnames.ts';

export interface BlockFn {
  (...mods: ClassValue[]): string;
}

export interface ElemFn {
  (elem: string, ...mods: ClassValue[]): string;
}

/**
 * Applies mods to the specified element.
 * @param element - element name.
 * @param mod - mod to apply.
 */
function mergeMods(parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((part): part is string => Boolean(part));
  return filtered.length ? filtered.join(' ') : undefined;
}

function applyMods(element: string, mod: ClassValue): string | undefined {
  if (Array.isArray(mod)) {
    return mergeMods((mod as ClassValue[]).map((m) => applyMods(element, m)));
  }
  if (isRecord(mod)) {
    const entries = Object.entries(mod).filter(([, enabled]) => Boolean(enabled));
    return mergeMods(entries.map(([modifier]) => applyMods(element, modifier)));
  }
  const v = classNames(mod);
  return v ? `${element}--${v}` : undefined;
}

/**
 * Computes final classname for the specified element.
 * @param element - element name.
 * @param mods - mod to apply.
 */
function computeClassnames(element: string, ...mods: ClassValue[]): string {
  const appliedMods: ClassValue[] = mods.map((mod) => applyMods(element, mod));
  return classNames(element, ...appliedMods);
}

/**
 * @returns A tuple, containing two functions. The first one generates classnames list for the
 * block, the second one generates classnames for its elements.
 * @param block - BEM block name.
 */
export function bem(block: string): [BlockFn, ElemFn] {
  return [
    (...mods) => computeClassnames(block, ...mods),
    (elem, ...mods) => computeClassnames(`${block}__${elem}`, ...mods),
  ];
}
