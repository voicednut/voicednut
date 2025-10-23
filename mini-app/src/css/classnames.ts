export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export type ClassDictionary = Record<string, unknown>;
export type ClassValue =
  | string
  | number
  | null
  | boolean
  | undefined
  | ClassDictionary
  | ClassValue[];

/**
 * Function which joins passed values with space following these rules:
 * 1. If value is non-empty string, it will be added to output.
 * 2. If value is number, it will be converted to string and added to output.
 * 3. If value is object, only those keys will be added, which values are truthy.
 * 4. If value is array, classNames will be called with this value spread.
 * 5. All other values are ignored.
 *
 * You can find this function similar to the package {@link https://www.npmjs.com/package/classnames|classnames}.
 * @param values - values array.
 * @returns Final class name.
 */
export function classNames(...values: ClassValue[]): string {
  return values
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }

      if (typeof value === 'number') {
        return value.toString();
      }

      if (isRecord(value)) {
        return classNames(
          Object.entries(value)
            .filter(([, flag]) => Boolean(flag))
            .map(([className]) => className)
        );
      }

      if (Array.isArray(value)) {
        return classNames(...value);
      }

      return undefined;
    })
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

type ClassNameMap = Record<string, ClassValue | undefined>;
type MergedKeys<T extends ClassNameMap[]> = keyof T[number];
export type MergeClassNames<T extends ClassNameMap[]> = { [K in MergedKeys<T>]?: string };

/**
 * Merges two sets of classnames.
 *
 * The function expects to pass an array of objects with values that could be passed to
 * the `classNames` function.
 * @returns An object with keys from all objects with merged values.
 * @see classNames
 */
export function mergeClassNames<T extends ClassNameMap[]>(...partials: T): MergeClassNames<T> {
  return partials.reduce<MergeClassNames<T>>((acc, partial) => {
    if (!partial) {
      return acc;
    }

    Object.entries(partial).forEach(([key, value]) => {
      const typedKey = key as keyof MergeClassNames<T>;
      const className = classNames(acc[typedKey], value ?? undefined);
      if (className) {
        acc[typedKey] = className;
      }
    });

    return acc;
  }, {} as MergeClassNames<T>);
}
