import PQueue from "p-queue";

import { env } from "../config/env.js";

// Concurrencia GLOBAL entre conversaciones distintas (configurable, ver
// QUEUE_CONCURRENCY en src/config/env.ts). No es la concurrencia dentro de una
// misma conversación — eso lo garantiza `conversationChains` más abajo, siempre
// en 1, sea cual sea este valor.
const queue = new PQueue({ concurrency: env.QUEUE_CONCURRENCY });

// Encadena las tareas de una misma conversación entre sí para que se sigan
// procesando de a una y en orden (evita condiciones de carrera leyendo/escribiendo
// su estado — ej. dos mensajes casi simultáneos derivando la misma conversación
// dos veces), mientras conversaciones DISTINTAS sí corren en paralelo entre sí a
// través de `queue`. Cada entrada se borra sola al terminar si nadie encoló nada
// nuevo para esa key mientras corría, para no crecer sin límite en memoria.
const conversationChains = new Map<number, Promise<void>>();

/**
 * Encola una tarea de procesamiento de mensaje, serializada por conversación.
 * El mensaje ya está persistido en la base antes de llegar acá (ver
 * webhook/routes.ts): si el proceso muere con la cola en danza, se pierde a lo
 * sumo una autorespuesta pendiente, nunca el registro del mensaje.
 *
 * Nunca deja escapar un error sin manejar: una falla procesando un mensaje no
 * debe tirar abajo el proceso (Node mata el proceso ante una promesa rechazada
 * sin catch) ni bloquear los mensajes siguientes de la cola, ni de esa
 * conversación ni de otras.
 */
export function enqueueMessageProcessing(conversationId: number, task: () => Promise<void>): void {
  const previous = conversationChains.get(conversationId) ?? Promise.resolve();

  const current = previous
    // Si la tarea anterior de esta conversación falló, no debe frenar la
    // siguiente — el catch de abajo ya la logueó, acá solo importa el orden.
    .catch(() => {})
    .then(() =>
      queue.add(async () => {
        try {
          await task();
        } catch (error) {
          console.error("[queue] error procesando mensaje:", error);
        }
      }),
    )
    .then(() => undefined);

  conversationChains.set(conversationId, current);

  void current.finally(() => {
    if (conversationChains.get(conversationId) === current) {
      conversationChains.delete(conversationId);
    }
  });
}

export function getQueueStats(): { pending: number; running: number; conversationsEnColas: number } {
  return { pending: queue.size, running: queue.pending, conversationsEnColas: conversationChains.size };
}
