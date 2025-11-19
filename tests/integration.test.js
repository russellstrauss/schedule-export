import { describe, it, expect } from 'vitest';
import fetch from 'node-fetch';

// Get function URL from environment or use default
const FUNCTION_URL = process.env.FUNCTION_URL || 'https://sync-schedule-v2ndhgjy3q-uc.a.run.app';
const TEST_EMAIL = process.env.TEST_EMAIL || 'russellstrauss@gmail.com';

describe('Deployed Cloud Function Integration Tests', () => {
  // Increase timeout for long-running function (scrapes website)
  const TEST_TIMEOUT = 600000; // 10 minutes

  it('should respond successfully to HTTP request', async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT);
    
    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        console.error('Response status:', response.status);
        console.error('Response text:', text);
      }
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('Schedule sync completed');
      expect(data.timestamp).toBeDefined();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }, TEST_TIMEOUT);

  it('should handle GET requests', async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      // Should either work or return method not allowed
      expect([200, 405]).toContain(response.status);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }, 30000);

  it('should handle OPTIONS (CORS preflight) requests', async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'POST'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }, 30000);

  it('should complete within reasonable time (5 minutes)', async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT);
    
    try {
      const startTime = Date.now();
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        signal: controller.signal
      });
      const endTime = Date.now();
      clearTimeout(timeoutId);
      
      const duration = (endTime - startTime) / 1000; // seconds

      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(300); // Should complete in under 5 minutes
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }, TEST_TIMEOUT);

  it('should return proper JSON structure', async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT);
    
    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      expect(response.ok).toBe(true);
      const data = await response.json();
      
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('timestamp');
      expect(typeof data.success).toBe('boolean');
      expect(typeof data.message).toBe('string');
      expect(typeof data.timestamp).toBe('string');
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }, TEST_TIMEOUT);
});

