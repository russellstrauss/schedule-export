#!/usr/bin/env node

/**
 * Run integration tests against deployed Cloud Function and send email on failure
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { sendEmail, formatTestFailureEmail } from './email-service.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from project root (where package.json is)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
dotenv.config({ path: join(projectRoot, '.env') });

const execAsync = promisify(exec);
const FUNCTION_URL = process.env.FUNCTION_URL || 'https://sync-schedule-v2ndhgjy3q-uc.a.run.app';
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || process.env.TEST_EMAIL || 'russellstrauss@gmail.com';

async function runTests() {
  console.log('🧪 Running integration tests against deployed function...');
  console.log(`📍 Function URL: ${FUNCTION_URL}`);
  console.log(`📧 Notification email: ${NOTIFICATION_EMAIL}`);
  
  // Check if email credentials are loaded from .env
  const hasEmailConfig = !!(process.env.SMTP_USER || process.env.GMAIL_USER);
  if (hasEmailConfig) {
    console.log('✅ Email credentials found in .env file');
  } else {
    console.log('⚠️  No email credentials found - notifications will be skipped');
  }
  console.log('');

  // Set function URL as environment variable for tests
  process.env.FUNCTION_URL = FUNCTION_URL;

  const startTime = Date.now();

  try {
    // Run vitest using CLI
    const { stdout, stderr } = await execAsync(
      `npx vitest run tests/integration.test.js --reporter=json`,
      { 
        env: { ...process.env, FUNCTION_URL },
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      }
    );

    const duration = Date.now() - startTime;

    // Parse JSON output from vitest
    let testResults;
    try {
      // Extract JSON from output (vitest outputs JSON at the end)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        testResults = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse test results');
      }
    } catch (parseError) {
      // Fallback: parse from stdout/stderr
      console.log('Raw output:', stdout);
      console.log('Errors:', stderr);
      
      // Try to extract test info from stdout
      const passedMatch = stdout.match(/(\d+) passed/);
      const failedMatch = stdout.match(/(\d+) failed/);
      const totalMatch = stdout.match(/Tests\s+(\d+)/);
      
      testResults = {
        numTotalTests: totalMatch ? parseInt(totalMatch[1]) : 0,
        numPassedTests: passedMatch ? parseInt(passedMatch[1]) : 0,
        numFailedTests: failedMatch ? parseInt(failedMatch[1]) : 0,
        testResults: []
      };
    }

    // Build test results object
    const results = {
      total: testResults.numTotalTests || 0,
      passed: testResults.numPassedTests || 0,
      failed: testResults.numFailedTests || 0,
      duration,
      timestamp: new Date().toISOString(),
      functionUrl: FUNCTION_URL,
      failures: [],
      output: stdout + stderr
    };

    // Extract failure details
    if (testResults.testResults) {
      for (const file of testResults.testResults) {
        for (const test of file.tasks || []) {
          if (test.result?.state === 'fail') {
            results.failures.push({
              name: test.name || 'Unknown test',
              error: test.result?.error?.message || test.result?.error?.stack || 'Test failed'
            });
          }
        }
      }
    }

    console.log('\n📊 Test Results:');
    console.log(`   Total: ${results.total}`);
    console.log(`   Passed: ${results.passed}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Duration: ${duration}ms\n`);

    // Send email if tests failed (optional - won't fail if email not configured)
    if (results.failed > 0) {
      console.log('❌ Tests failed!');
      
      // Try to send email notification (optional)
      const hasEmailConfig = process.env.SMTP_USER || process.env.GMAIL_USER;
      if (hasEmailConfig) {
        console.log('Sending notification email...');
        try {
          const emailContent = formatTestFailureEmail(results);
          await sendEmail({
            to: NOTIFICATION_EMAIL,
            ...emailContent
          });
          console.log('✅ Notification email sent successfully');
        } catch (emailError) {
          console.error('⚠️  Failed to send notification email:', emailError.message);
          console.error('   Tests still failed - check output above for details');
        }
      } else {
        console.log('⚠️  Email notifications not configured (optional)');
        console.log('   To enable, set SMTP_USER and SMTP_PASSWORD (or GMAIL_USER and GMAIL_APP_PASSWORD)');
      }
      
      process.exit(1);
    } else {
      console.log('✅ All tests passed!');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Error running tests:', error);
    
    // Try to send email about test execution error (optional)
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
        console.error('⚠️  Failed to send error notification:', emailError.message);
      }
    }
    
    process.exit(1);
  }
}

// Run tests
runTests();

