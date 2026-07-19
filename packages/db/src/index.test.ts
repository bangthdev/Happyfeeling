import { describe, it, expect } from 'vitest';
import { prisma } from './index.js';

describe('index', () => {
  it('exports the shared prisma client', () => {
    expect(prisma).toBeDefined();
    expect(prisma.finding).toBeDefined();
  });
});
