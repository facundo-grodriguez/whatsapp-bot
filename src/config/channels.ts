/**
 * Etiquetas legibles para cada `channelId` (el `phone_number_id` de Meta, un
 * número largo sin significado a simple vista — ver src/db/schema.ts). Sin esto
 * el dashboard mostraría "Volumen por canal: 123456789012345" en vez de un
 * nombre reconocible. Cargar acá un número por cada línea de WhatsApp Business
 * que tenga el negocio (ver README, sección "Varios números").
 *
 * Con un solo número no hace falta tocar esto: getChannelLabel devuelve el id
 * crudo si no hay entrada en el mapa, así que el dashboard sigue andando igual.
 */
export const CHANNEL_LABELS: Record<string, string> = {
  // Tu número real de prueba de Meta, con las FAQs de PrintLab 3D cargadas
  // (2026-08-04, ver config/rules.ts) — todavía contenido de prueba, no un
  // negocio real, pero ya específico del rubro elegido para simular.
  "1252084911324044": "PrintLab 3D",
};

export function getChannelLabel(channelId: string): string {
  return CHANNEL_LABELS[channelId] ?? channelId;
}
