import Fastify from "fastify";

const app = Fastify({ logger: true });
let flakyAttempts = 0;

app.post("/success", async () => ({ received: true }));
app.post("/fail-500", async (_request, reply) => reply.code(500).send({ error: "configured failure" }));
app.post("/rate-limit", async (_request, reply) => reply.code(429).header("retry-after", "1").send({ error: "configured rate limit" }));
app.post("/timeout", async () => new Promise((resolve) => setTimeout(() => resolve({ late: true }), 30_000)));
app.post("/flaky", async (_request, reply) => {
  flakyAttempts += 1;
  return flakyAttempts < 3 ? reply.code(500).send({ error: "temporary failure", attempt: flakyAttempts }) : { received: true, attempt: flakyAttempts };
});
app.post("/reset", async () => {
  flakyAttempts = 0;
  return { reset: true };
});

const port = Number(process.env.RECEIVER_PORT ?? 3100);
await app.listen({ port, host: "0.0.0.0" });
