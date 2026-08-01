import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combina classes do Tailwind resolvendo conflitos (a última vence). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
