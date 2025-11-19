// Entry point for test function
import { sendEmail, formatTestFailureEmail } from './tests/email-service.js';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const FUNCTION_URL = process.env.FUNCTION_URL || 'https://sync-schedule-v2ndhgjy3q-uc.a.run.app';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const TEST_TIMEOUT = 600000; // 10 minutes

/**
 * Cloud Function entry point for running integration tests
 * Can be triggered by HTTP request or Cloud Scheduler
 */
export async function runTests(req, res) {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: [],
    timestamp: new Date().toISOString(),
    functionUrl: FUNCTION_URL
  };

  try {
    if (!NOTIFICATION_EMAIL) {
      throw new Error('NOTIFICATION_EMAIL environment variable is required');
    }
    
    console.log('🧪 Starting integration tests...');
    console.log(`📍 Function URL: ${FUNCTION_URL}`);
    console.log(`📧 Notification email: ${NOTIFICATION_EMAIL}`);

    const startTime = Date.now();

    // Run unit tests first
    console.log('🧪 Running unit tests...');
    results.total++;
    try {
      const { stdout, stderr } = await execAsync(
        'npx vitest run get-schedule/utils.test.js --reporter=json',
        { 
          env: { ...process.env },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000 // 1 minute for unit tests
        }
      );

      // Parse vitest JSON output
      let unitTestResults;
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          unitTestResults = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        // Fallback parsing
        const passedMatch = stdout.match(/(\d+) passed/);
        const failedMatch = stdout.match(/(\d+) failed/);
        unitTestResults = {
          numTotalTests: 0,
          numPassedTests: passedMatch ? parseInt(passedMatch[1]) : 0,
          numFailedTests: failedMatch ? parseInt(failedMatch[1]) : 0
        };
      }

      const unitPassed = unitTestResults?.numPassedTests || 0;
      const unitFailed = unitTestResults?.numFailedTests || 0;
      const unitTotal = unitTestResults?.numTotalTests || (unitPassed + unitFailed);

      if (unitFailed > 0) {
        throw new Error(`${unitFailed} unit test(s) failed out of ${unitTotal}`);
      }

      results.passed++;
      console.log(`✅ Unit tests passed: ${unitPassed}/${unitTotal}`);
    } catch (error) {
      results.failed++;
      results.failures.push({
        name: 'Unit tests',
        error: error.message || String(error)
      });
      console.error('❌ Unit tests failed:', error.message);
    }

    // TEMPORARY: Intentional failure test - remove after viewing email
    results.total++;
    results.failed++;
    results.failures.push({
      name: 'EXAMPLE: Intentional failure to demonstrate email notifications',
      error: 'This test always fails so you can see the email notification format. Remove this test after viewing the email.'
    });
    console.error('❌ EXAMPLE test failed (intentional)');

    // Test 1: Function responds successfully
    results.total++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT);
      
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(`Function returned success: false - ${data.error || data.message}`);
      }

      if (!data.timestamp) {
        throw new Error('Response missing timestamp field');
      }

      results.passed++;
      console.log('✅ Test 1 passed: Function responds successfully');
    } catch (error) {
      results.failed++;
      results.failures.push({
        name: 'Function responds successfully',
        error: error.message || String(error)
      });
      console.error('❌ Test 1 failed:', error.message);
    }

    // Test 2: Function returns proper JSON structure
    results.total++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT);
      
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (typeof data.success !== 'boolean') {
        throw new Error('Response missing or invalid success field');
      }
      if (typeof data.message !== 'string') {
        throw new Error('Response missing or invalid message field');
      }
      if (typeof data.timestamp !== 'string') {
        throw new Error('Response missing or invalid timestamp field');
      }

      results.passed++;
      console.log('✅ Test 2 passed: Function returns proper JSON structure');
    } catch (error) {
      results.failed++;
      results.failures.push({
        name: 'Function returns proper JSON structure',
        error: error.message || String(error)
      });
      console.error('❌ Test 2 failed:', error.message);
    }

    // Test 3: Function completes within reasonable time
    results.total++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT);
      const testStart = Date.now();
      
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const duration = Date.now() - testStart;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (duration > 300000) { // 5 minutes
        throw new Error(`Function took too long: ${Math.round(duration / 1000)}s`);
      }

      results.passed++;
      console.log(`✅ Test 3 passed: Function completed in ${Math.round(duration / 1000)}s`);
    } catch (error) {
      results.failed++;
      results.failures.push({
        name: 'Function completes within reasonable time',
        error: error.message || String(error)
      });
      console.error('❌ Test 3 failed:', error.message);
    }

    results.duration = Date.now() - startTime;
    console.log(`📊 Test Results: ${results.passed} passed, ${results.failed} failed out of ${results.total} total`);

    // Send email if tests failed
    if (results.failed > 0) {
      console.log('❌ Tests failed! Sending notification email...');
      
      try {
        const emailContent = formatTestFailureEmail(results);
        await sendEmail({
          to: NOTIFICATION_EMAIL,
          ...emailContent
        });
        console.log('✅ Notification email sent successfully');
      } catch (emailError) {
        console.error('⚠️  Failed to send notification email:', emailError.message);
      }
      
      res.status(500).json({
        success: false,
        message: 'Tests failed',
        results: {
          total: results.total,
          passed: results.passed,
          failed: results.failed,
          failures: results.failures
        },
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('✅ All tests passed!');
      res.status(200).json({
        success: true,
        message: 'All tests passed',
        results: {
          total: results.total,
          passed: results.passed,
          failed: results.failed
        },
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Error running tests:', error);
    
    // Try to send email about test execution error
    const hasEmailConfig = process.env.SMTP_USER || process.env.GMAIL_USER;
    if (hasEmailConfig) {
      try {
        await sendEmail({
          to: NOTIFICATION_EMAIL,
          subject: `❌ Test Execution Error - ${new Date().toLocaleString()}`,
          html: `
            <h2>Test Execution Error</h2>
            <p>An error occurred while running integration tests:</p>
            <pre>${error.message}</pre>
            <p><strong>Function URL:</strong> ${FUNCTION_URL}</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          `
        });
      } catch (emailError) {
        console.error('Failed to send error notification:', emailError.message);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

