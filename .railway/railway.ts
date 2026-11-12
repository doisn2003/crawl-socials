import { defineRailway, project, service } from 'railway/iac';

export const partial = 'findlink-api';

export default defineRailway(() => project('findlink-starter', {
  variables: { managed: false },
  resources: [service('findlink-api', {
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    env: { PORT: '9070' },
    healthcheck: '/healthz',
    healthcheckTimeout: 120,
    preDeploy: 'node dist/backend/index.js --migrate',
  })],
}));
