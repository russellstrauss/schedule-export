// Test using Google Auth Library for proper authentication
import { google } from 'googleapis';

export async function testGoogleAuth(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  
  try {
    const auth = new google.auth.GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/datastore',
        'https://www.googleapis.com/auth/cloud-platform'
      ]
    });
    
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();
    const token = await client.getAccessToken();
    
    console.log('Auth client type:', client.constructor.name);
    console.log('Project ID:', projectId);
    console.log('Token:', {
      hasToken: !!token.token,
      length: token.token?.length
    });
    
    // Test Firestore with properly scoped token
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/iatse927_messages?pageSize=1`;
    const firestoreRes = await fetch(firestoreUrl, {
      headers: {
        'Authorization': `Bearer ${token.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const firestoreBody = await firestoreRes.text();
    
    res.status(200).json({
      success: firestoreRes.ok,
      authType: client.constructor.name,
      projectId,
      tokenInfo: {
        length: token.token?.length || 0,
        prefix: token.token?.substring(0, 20) || ''
      },
      firestore: {
        status: firestoreRes.status,
        body: firestoreBody.substring(0, 2000)
      }
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack
    });
  }
}
