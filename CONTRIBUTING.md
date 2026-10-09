# Contributing

Thanks for taking a look at HookED. Focused bug fixes, tests, documentation improvements, and small reliability features are welcome.

## Development setup

1. Start PostgreSQL and Redis with `docker compose up postgres redis`.
2. Copy `.env.example` to `.env` and replace hostnames with `localhost` when running Node outside Docker.
3. Run `npm install` and `npm run migrate`.
4. Start `npm run dev` and `npm run worker` in separate terminals.

Before opening a pull request, run:

```bash
npm run typecheck
npm run lint
npm test
RUN_INTEGRATION=true npm run test:integration
npm run build
```

Keep changes within the service's scope. New delivery behavior should include a deterministic test and documentation for its failure mode.
