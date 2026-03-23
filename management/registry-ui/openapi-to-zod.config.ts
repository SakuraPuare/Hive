import { defineConfig } from '@cerios/openapi-to-zod';

export default defineConfig({
  specs: [
    {
      input: 'src/generated/openapi3/openapi.yaml',
      outputTypes: 'src/generated/zod/schemas.ts',
    },
  ],
});

