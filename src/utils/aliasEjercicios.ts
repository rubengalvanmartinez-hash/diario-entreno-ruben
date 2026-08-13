/**
 * Alias de ejercicios: nombre antiguo del historial → nombre actual en la configuración.
 *
 * Las CLAVES deben estar ya normalizadas con normalizarNombre() (minúsculas,
 * sin tildes, sin espacios extra). Los VALORES son los nombres actuales tal
 * cual aparecen en la configuración (se normalizan al comparar).
 *
 * Este archivo no importa nada a propósito, para evitar dependencias circulares
 * con utils/normalizar.ts (que importa este mapa).
 */
export const ALIAS_EJERCICIOS: Record<string, string> = {
  // "Hip Thrust" / "Hip thrust" (ambas normalizan igual)
  'hip thrust': 'HipTrust',
  // "Biceps" / "Bíceps" (ambas normalizan igual)
  'biceps': 'Bíceps con barra fija',
  'biceps martillo mancuernas': 'Biceps martillo',
  'peso muerto libre': 'Peso muerto',
  'pecho inclinado': 'Pecho inclinado mancuernas',
  'presa de pierna': 'Press de pierna',
  // "Prensa 45º": normalizarNombre no elimina el símbolo — cubrimos el
  // ordinal masculino (º, U+00BA) y el símbolo de grados (°, U+00B0)
  'prensa 45º': 'Prensa 45',
  'prensa 45°': 'Prensa 45',
  'sentadilla hack': 'Sentadilla Hack',
  // "Abdominales " (con espacio final; normalizarNombre ya hace trim)
  'abdominales': 'Abdominales',
}
