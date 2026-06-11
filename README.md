# Simmit SDK for TypeScript

TypeScript SDK for the [Simmit API](https://api.simmit.com) — cloud execution for SimulationCraft.

> **Pre-release.** The public surface is specified in [DESIGN.md](./DESIGN.md); implementation is in progress. Do not depend on this package yet.

## Development

- Node 20+ (`.nvmrc` pins the dev version), pnpm.
- `pnpm generate` — regenerate `src/generated/openapi.d.ts` from the committed `openapi.json` snapshot. Never hand-edit generated output; only `src/api-types.ts` may import from `src/generated/`.
- `pnpm build` — dual ESM+CJS via tsup.

## License

MIT
