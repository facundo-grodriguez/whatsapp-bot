export interface NotifyVendorInput {
  conversationId: number;
  channelId: string;
  chatId: string;
  body: string;
}

/**
 * STUB — todavía no hay un canal real para avisarle al vendedor (WhatsApp interno,
 * email, Slack, etc.). Se deja como punto de extensión explícito: cuando se
 * defina el canal, esta es la única función a completar; el resto del
 * orquestador ya la llama en el momento correcto (ver handleIncomingMessage.ts).
 */
export async function notifyVendor(input: NotifyVendorInput): Promise<void> {
  console.log(
    `[notifyVendor STUB] conversación derivada -> channelId="${input.channelId}" ` +
      `chatId="${input.chatId}" conversationId=${input.conversationId} mensaje="${input.body}"`,
  );
}
