import express from 'express';
import { verifySignature } from './webhook/verify.js';
import { parsePullRequestEvent, type PullRequestEvent } from './webhook/parse.js';

export interface ServerConfig {
  webhookSecret: string;
  runPipeline?: (event: PullRequestEvent) => Promise<void>;
}

export function createServer(config: ServerConfig): express.Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const signature = req.header('x-hub-signature-256');
    if (!verifySignature(req.body, signature, config.webhookSecret)) {
      res.status(401).send('invalid signature');
      return;
    }

    const payload = JSON.parse((req.body as Buffer).toString('utf8'));
    const event = parsePullRequestEvent(payload);
    if (!event) {
      res.status(200).send('ignored');
      return;
    }

    res.status(202).send('accepted');
    if (config.runPipeline) {
      config.runPipeline(event).catch((err) => console.error('Pipeline error:', err));
    }
  });

  return app;
}
