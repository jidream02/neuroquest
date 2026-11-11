import { getRandomBytes } from 'expo-crypto';

/** Криптографически стойкие случайные байты (системный генератор ОС / браузера). */
export const secureRandomBytes = (n: number): Uint8Array => getRandomBytes(n);
