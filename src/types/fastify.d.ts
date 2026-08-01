import "fastify";

// El content-type parser custom de server.ts guarda el body crudo acá para
// poder verificar la firma HMAC de WAHA (que se calcula sobre los bytes tal
// cual llegaron, no sobre el JSON re-serializado).
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
