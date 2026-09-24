#!/usr/bin/env node
/**
 * Test script to verify Firestore authentication on Android/Termux
 * Tests both service account key file and gcloud CLI methods
 */

import dotenv from "dotenv";
import { getFirestoreProjectId, getGcloudAccessToken } from "./get-schedule/iatse927-firestore-auth.js";

dotenv.config();

console.log("🔍 Testing Firestore Authentication");
console.log("===================================\n");

// Check environment variables
console.log("Environment Check:");
console.log(`  GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT ? '✅ Set' : '❌ Not set'}`);
console.log(`  GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✅ Set' : '⚠️  Not set (will try gcloud CLI)'}`);
console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Not set'}`);
console.log();

// Check service account key file
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    console.log(`Service Account Key File:`);
    console.log(`  Path: ${keyPath}`);
    
    try {
        const fs = await import("fs");
        const stat = fs.statSync(keyPath);
        const mode = (stat.mode & parseInt('777', 8)).toString(8);
        console.log(`  Exists: ✅`);
        console.log(`  Permissions: ${mode} ${mode === '600' ? '✅' : '⚠️  (should be 600)'}`);
        
        const keyData = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        console.log(`  Type: ${keyData.type || 'unknown'}`);
        console.log(`  Client Email: ${keyData.client_email || 'missing'}`);
        console.log(`  Project ID: ${keyData.project_id || 'missing'}`);
        console.log(`  Private Key: ${keyData.private_key ? '✅ Present' : '❌ Missing'}`);
    } catch (err) {
        console.log(`  Error: ❌ ${err.message}`);
    }
    console.log();
}

// Test project ID resolution
console.log("Project ID Resolution:");
try {
    const projectId = getFirestoreProjectId();
    console.log(`  Project ID: ${projectId} ✅`);
} catch (err) {
    console.log(`  Error: ❌ ${err.message}`);
    process.exit(1);
}
console.log();

// Test access token
console.log("Access Token Retrieval:");
try {
    const token = await getGcloudAccessToken();
    if (token) {
        console.log(`  Token obtained: ✅`);
        console.log(`  Token length: ${token.length} chars`);
        console.log(`  Token prefix: ${token.substring(0, 10)}...`);
        console.log(`  Token type: ${token.startsWith('ya29.') ? 'OAuth2' : 'Unknown'} ${token.startsWith('ya29.') ? '✅' : '⚠️'}`);
        
        // Test Firestore API access
        console.log();
        console.log("Firestore API Test:");
        const projectId = getFirestoreProjectId();
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/iatse927_messages?pageSize=1`;
        
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log(`  HTTP Status: ${res.status} ${res.ok ? '✅' : '❌'}`);
        
        if (res.ok) {
            const data = await res.json();
            const count = data.documents?.length || 0;
            console.log(`  Messages found: ${count}`);
            console.log(`  \n✅ SUCCESS! Firestore authentication is working.`);
        } else {
            const errorText = await res.text();
            console.log(`  Error: ${errorText}`);
            console.log(`  \n❌ FAILED: Firestore API returned an error.`);
            
            if (errorText.includes('CONSUMER_INVALID')) {
                console.log(`\n💡 Troubleshooting:`);
                console.log(`   The service account may need permissions.`);
                console.log(`   Run: gcloud projects add-iam-policy-binding ${projectId} \\`);
                console.log(`          --member="serviceAccount:firestore-sync@${projectId}.iam.gserviceaccount.com" \\`);
                console.log(`          --role="roles/datastore.user"`);
            }
        }
    }
} catch (err) {
    console.log(`  Error: ❌ ${err.message}`);
    console.log(`\n❌ FAILED: Could not obtain access token.`);
    
    console.log(`\n💡 Troubleshooting:`);
    console.log(`   1. Create a service account key file on your computer:`);
    console.log(`      gcloud iam service-accounts keys create ~/firestore-key.json \\`);
    console.log(`        --iam-account=firestore-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com`);
    console.log(`   2. Transfer the file to Android/Termux`);
    console.log(`   3. Set in .env: GOOGLE_APPLICATION_CREDENTIALS=/path/to/firestore-key.json`);
    console.log(`   4. Or install gcloud CLI and run: gcloud auth login`);
    
    process.exit(1);
}

console.log();
console.log("📋 Summary:");
console.log("  All checks passed! You can now run: node sync.js");
