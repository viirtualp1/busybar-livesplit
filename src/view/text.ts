export const MAX_SPLIT_NAME_LETTERS = 10;
const ELLIPSIS = '...';

/**
 * Spaces do not count towards the limit, so a name made of short words keeps as
 * many letters as a single long one instead of being cut earlier.
 */
export function truncateName(
  name: string,
  maxLetters: number = MAX_SPLIT_NAME_LETTERS,
): string {
  let letters = 0;
  for (let i = 0; i < name.length; i += 1) {
    if (name.charAt(i) !== ' ') {
      letters += 1;
    }
    if (letters > maxLetters) {
      return `${name.slice(0, i).trimEnd()}${ELLIPSIS}`;
    }
  }
  return name;
}
