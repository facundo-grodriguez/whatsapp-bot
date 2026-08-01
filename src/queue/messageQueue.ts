import PQueue from "p-queue";

// Concurrency 1: los mensajes se procesan de a uno, en orden de llegada. Alcanza
// para el volumen de una sola sesión (Fase 1) y evita condiciones de carrera al
// leer/escribir el estado de una conversación (ver handleIncomingMessage.ts).
const queue = new PQueue({ concurrency: 1 });

/**
 * Encola una tarea de procesamiento de mensaje. El mensaje ya está persistido en
 * la base antes de llegar acá (ver webhook/routes.ts): si el proceso muere con
 * la cola en danza, se pierde a lo sumo una autorespuesta pendiente, nunca el
 * registro del mensaje.
 *
 * Nunca deja escapar un error sin manejar: una falla procesando un mensaje no
 * debe tirar abajo el proceso (Node mata el proceso ante una promesa rechazada
 * sin catch) ni bloquear los mensajes siguientes de la cola.
 */
export function enqueueMessageProcessing(task: () => Promise<void>): void {
  void queue.add(async () => {
    try {
      await task();
    } catch (error) {
      console.error("[queue] error procesando mensaje:", error);
    }
  });
}

export function getQueueStats(): { pending: number; running: number } {
  return { pending: queue.size, running: queue.pending };
}
