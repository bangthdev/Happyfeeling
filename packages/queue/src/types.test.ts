import { describe, expect, it } from 'vitest';
import { REVIEW_QUEUE_NAME } from './types.js';

describe('REVIEW_QUEUE_NAME', () => {
  it('is a non-empty string', () => {
    expect(REVIEW_QUEUE_NAME).toBe('review');
  });
});
